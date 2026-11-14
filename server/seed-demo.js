// A few made-up demo books so you can try the planner before scanning your own shelf.
// They're flagged as demo data and can be removed in one click from the Library page.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, Store } from './db.js';

const DEMO = [
  {
    title: 'Lean Green Weeknights', authors: 'Penny Parsnip', colour: '#3fa66b', year: '2023',
    tags: ['Low calorie', 'Quick'],
    recipes: `Chicken and leek pie 45|Turkey meatballs in tomato sauce 52|Speedy prawn stir-fry 18|Spiced lentil soup (V) 12|
      Lemon and herb roast chicken 47|Chilli con carne with cauliflower rice 66|Salmon traybake with green beans 33|
      Mushroom stroganoff (V) 71|Chicken tikka skewers 40|Thai green curry with chicken 58|Butternut squash risotto (V) 74|
      Smoky bean burgers (V) 79|Cod with chorizo and chickpeas 36|Beef and broccoli noodles 62|Overnight oats three ways 8|
      Berry yoghurt pots 90|Feta and spinach frittata (V) 24|Greek chicken salad 28|Pork and apple burgers 55|Baked eggs with tomatoes 10`,
  },
  {
    title: 'The 20-Minute Kitchen', authors: 'Ravi Kettle', colour: '#e8603c', year: '2021',
    tags: ['Quick', 'Family favourites'],
    recipes: `Prawn pad thai 14|Chicken fajitas 22|Halloumi and roasted veg wraps (V) 30|Sticky soy salmon 26|
      Egg fried rice with peas 18|Lamb kofta flatbreads 40|Tomato and mascarpone pasta (V) 12|Chorizo and bean stew 44|
      Steak with chimichurri 48|Pesto chicken traybake 36|Tuna pasta bake 16|Paneer tikka masala (V) 52|Fish finger tacos 28|
      Gnocchi with sausage and kale 34|Chicken katsu curry 56|Shakshuka (V) 8|Banana pancakes 6|Pea and mint soup (V) 10|
      Five-minute chocolate mug cake 92|Quick lemon posset 94`,
  },
  {
    title: 'Slow & Low: Batch Cooking', authors: 'Martha Simmer, Joe Ladle', colour: '#8a5bd6', year: '2019',
    tags: ['Batch cooking', 'Slow cooker'],
    recipes: `Beef and ale stew with dumplings 112|Slow cooker pulled pork 98|Chicken cacciatore 104|Lamb rogan josh 120|
      Moroccan chickpea tagine (V) 88|Cottage pie 116|Sausage and lentil casserole 102|Beef ragu with pappardelle 108|
      Chicken and chorizo jambalaya 94|Vegetable lasagne (V) 84|Lamb shank hotpot 124|Black bean chilli (V) 80|
      Coq au vin 128|Pork and cider casserole 100|Minestrone soup (V) 76|Apple and blackberry crumble 140|Sticky toffee pudding 144|
      Rice pudding with jam 146|Porridge with cinnamon apples 70|Big-batch tomato sauce 72`,
  },
  {
    title: 'Plants on the Plate', authors: 'Ivy Sprout', colour: '#2b9bb3', year: '2022',
    tags: ['Vegetarian'],
    recipes: `Sweet potato and black bean chilli 30|Mushroom and chestnut wellington 88|Cauliflower and chickpea curry 42|
      Aubergine parmigiana 56|Spinach and ricotta cannelloni 60|Halloumi traybake with peppers 36|Tofu satay noodles 48|
      Leek and goat's cheese tart 64|Roasted tomato soup 14|Falafel with tahini slaw 24|Squash and sage gnocchi 52|
      Vegetable biryani 46|Smashed bean bruschetta 18|Pea and feta fritters 20|Granola with toasted seeds 8|
      Chocolate avocado mousse 102|Mango and lime sorbet 106|Carrot cake 110|Lentil shepherd's pie 70|Miso aubergine with rice 40`,
  },
  {
    title: 'Sunday Best', authors: 'Martha Simmer', colour: '#d6a21e', year: '2018',
    tags: ['Family favourites', 'Entertaining'],
    recipes: `Roast leg of lamb with rosemary 22|Perfect roast chicken 14|Beef wellington 30|Toad in the hole 44|
      Fish pie 50|Roast pork belly with crackling 26|Chicken, ham and leek pie 46|Salmon en croute 54|Yorkshire puddings 60|
      Crispy roast potatoes 62|Cauliflower cheese 66|Sherry trifle 80|Lemon meringue pie 84|Eton mess 88|
      Bread and butter pudding 90|Full English breakfast 8|Eggs benedict 10|Kedgeree 12|Scones with jam and cream 96|Victoria sponge 98`,
  },
];

export function seedDemo(store) {
  let recipes = 0;
  for (const b of DEMO) {
    const id = store.saveBook({ ...b, is_demo: true, notes: 'Demo book: delete me once your own books are in!' });
    const entries = b.recipes
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const m = s.match(/^(.*?)\s+(\d+)$/);
        const veg = /\(V\)/.test(m[1]);
        return { name: m[1].replace(/\s*\(V\)\s*/, '').trim(), page: m[2], tags: veg ? ['vegetarian'] : [] };
      });
    recipes += store.addRecipes(id, entries).added;
  }
  // A few favourites and ratings so the planner has some preferences to work with.
  const all = store.allRecipes();
  for (const r of all.filter((_, i) => i % 7 === 0)) store.updateRecipe(r.id, { favourite: true, rating: 5 });
  return { books: DEMO.length, recipes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const store = new Store(openDb());
  const r = seedDemo(store);
  console.log(`Added ${r.books} demo books with ${r.recipes} recipes.`);
}
