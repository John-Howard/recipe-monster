// Optional: read index pages and book covers with Claude's vision.
// Enabled when ANTHROPIC_API_KEY is set; otherwise the phone does OCR itself with Tesseract.js
// and the text goes through the heuristic parser in indexParser.js.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { COURSES } from './tagger.js';

const MODEL = process.env.RECIPE_MONSTER_MODEL || 'claude-opus-5-5';
let client = null;

export function aiEnabled() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function imageBlock(dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) throw new Error('Expected a base64 image data URL');
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

const IndexSchema = z.object({
  entries: z.array(
    z.object({
      name: z.string().describe('Full recipe name, written as it would appear as a recipe title'),
      page: z.string().describe('First page number for the recipe'),
      tags: z.array(z.string()).describe('Dietary markers shown next to the entry, e.g. vegetarian, vegan, gluten-free, dairy-free'),
    })
  ),
});

const INDEX_PROMPT = `This is a photo of an index page from a cookbook. List every recipe it indexes.

- Give each recipe's full name as a recipe title. When an entry sits under an ingredient heading
  (e.g. "chicken" then "– and leek pie 45"), combine them into the full name ("Chicken and leek pie").
- Skip bare ingredient or topic headings that only list page references (e.g. "asparagus 12, 34, 56"),
  "see also" cross-references, and section letters.
- Use the first page number when several are listed.
- If a recipe appears twice on the page under different headings, include it once.
- Add dietary tags only when the page marks them (V, VG, GF, DF symbols or a key).
- If the photo is not a cookbook index, return an empty list.`;

export async function extractIndex(dataUrl) {
  const res = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(IndexSchema) },
    messages: [{ role: 'user', content: [imageBlock(dataUrl), { type: 'text', text: INDEX_PROMPT }] }],
  });
  if (res.stop_reason === 'refusal') throw new Error('The model declined to read this image.');
  if (res.stop_reason === 'max_tokens') throw new Error('That page had more entries than expected; try photographing half a page at a time.');
  return res.parsed_output?.entries ?? [];
}

const BookSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  authors: z.array(z.string()),
  publisher: z.string(),
  year: z.string(),
  isbn: z.string(),
  suggested_tags: z
    .array(z.string())
    .describe('Diet plans, styles or themes the book belongs to, e.g. "Slimming World", "Fast 800", "Vegetarian", "Batch cooking"'),
});

const BOOK_PROMPT = `This is a photo of a cookbook's cover, spine, title page or copyright page.
Read the book's details. Use an empty string for anything you can't see. For suggested_tags, name any
diet plan or eating style the book clearly belongs to (for example "Slimming World", "Fast 800",
"5:2 diet", "Keto", "Vegan", "Batch cooking", "Air fryer"); leave it empty if none is obvious.`;

export async function extractBook(dataUrl) {
  const res = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(BookSchema) },
    messages: [{ role: 'user', content: [imageBlock(dataUrl), { type: 'text', text: BOOK_PROMPT }] }],
  });
  if (res.stop_reason === 'refusal') throw new Error('The model declined to read this image.');
  return res.parsed_output;
}

const CourseSchema = z.object({
  courses: z.array(z.object({ id: z.number(), course: z.enum(COURSES) })),
});

const BATCH = 150;

export function applyCourseResults(batch, results) {
  const ids = new Set(batch.map((r) => r.id));
  const seen = new Set();
  return results.filter((r) => {
    if (!ids.has(r.id) || seen.has(r.id) || !COURSES.includes(r.course)) return false;
    seen.add(r.id);
    return true;
  }).map(({ id, course }) => ({ id, course }));
}

const coursePrompt = (book, batch) => `These recipe names come from the cookbook "${book.title}"${book.authors ? ` by ${book.authors}` : ''}.
Give each recipe exactly one course:
- starter: a small first course (soup, pate, dip, bruschetta)
- main: a substantial savoury dish that can be the centre of an evening meal
- dessert: a sweet pudding or treat
- side: an accompaniment (vegetable side, plain salad)
- breakfast
- other: baking, sauces, drinks, snacks, spreads, condiments

Recipes (id: name):
${batch.map((r) => `${r.id}: ${r.name}`).join('\n')}`;

export async function classifyCourses(recipes, book) {
  const out = [];
  for (let i = 0; i < recipes.length; i += BATCH) {
    const batch = recipes.slice(i, i + BATCH);
    const res = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(CourseSchema) },
      messages: [{ role: 'user', content: coursePrompt(book, batch) }],
    });
    if (res.stop_reason === 'refusal') throw new Error('The model declined to classify these recipes.');
    out.push(...applyCourseResults(batch, res.parsed_output?.courses ?? []));
  }
  return out;
}
