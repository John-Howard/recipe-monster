// Guess useful tags (main ingredient, dish type, course, cuisine) from a recipe's name.
// These are only suggestions: the planner uses the course tags to fill breakfast/lunch/dinner/pudding
// slots, and everything is searchable and editable.

const RULES = [
  // proteins / main ingredient
  ['chicken', /\bchicken|poussin|coq au vin\b/],
  ['beef', /\bbeef|steak|brisket|bolognese|meatball|beef ?burger|mince\b|cottage pie|chilli con carne|beef stroganoff|beef wellington|bourguignon/],
  ['lamb', /\blamb|mutton|kofta|moussaka|shepherd'?s pie|hotpot/],
  ['pork', /\bpork|bacon|ham\b|sausage|chorizo|pancetta|prosciutto|gammon|carbonara|toad in the hole|pulled pork|ribs?\b/],
  ['turkey', /\bturkey\b/],
  ['duck', /\bduck\b/],
  ['fish', /\bfish|salmon|cod\b|haddock|tuna|mackerel|trout|sea ?bass|bream|hake|halibut|plaice|sardine|anchov|kipper|pollock|monkfish|kedgeree/],
  ['seafood', /\bprawn|shrimp|mussel|crab|lobster|scallop|squid|calamari|clam|oyster|seafood/],
  ['eggs', /\beggs?\b|omelet|frittata|shakshuka|quiche|souffl[eé]|benedict/],
  ['pulses', /\blentil|chickpea|\bbeans?\b|dhal|dal\b|houmous|hummus|falafel/],
  ['tofu', /\btofu|tempeh|seitan/],
  ['cheese', /\bcheese|halloumi|feta|paneer|mozzarella|parmesan|cheddar|goat'?s cheese|ricotta|gorgonzola|camembert|brie/],
  ['mushroom', /\bmushroom/],
  // dish types
  ['soup', /\bsoup|broth|chowder|bisque|gazpacho|minestrone|ramen|pho\b|consomm/],
  ['salad', /\bsalad|slaw|tabbouleh|nicoise|caesar/],
  ['curry', /\bcurry|tikka|masala|korma|biryani|jalfrezi|rogan josh|vindaloo|madras|balti|dhansak|massaman|rendang|bhuna|saag|dopiaza/],
  ['pasta', /\bpasta|spaghetti|linguine|penne|fusilli|lasagne|lasagna|tagliatelle|macaroni|mac (and|&|n) cheese|ravioli|tortellini|orzo|gnocchi|carbonara|bolognese|pappardelle|rigatoni|conchiglie|farfalle/],
  ['rice', /\brisotto|paella|pilaf|pilau|fried rice|biryani|jambalaya|kedgeree|\brice\b/],
  ['noodles', /\bnoodle|pad thai|chow mein|udon|soba|ramen|laksa/],
  ['stir-fry', /\bstir[- ]?fr(y|ied)/],
  ['pie', /\bpie\b|\btart\b|pasty|pasties|wellington|pithivier|en croute/],
  ['stew', /\bstew|casserole|hotpot|tagine|goulash|ragu|ragout|cassoulet|bourguignon|daube/],
  ['traybake', /\btray ?bake|sheet ?pan|one[- ]pan|one[- ]pot/],
  ['roast', /\broast(ed)?\b/],
  ['burger', /\bburgers?\b/],
  ['pizza', /\bpizza|flatbread|calzone/],
  ['tacos & wraps', /\btaco|burrito|fajita|enchilada|quesadilla|\bwraps?\b/],
  ['bbq', /\bbbq|barbecue|grilled|kebab|skewer|souvlaki|satay/],
  // course
  ['breakfast', /\bbreakfast|porridge|granola|muesli|pancake|waffle|overnight oats|french toast|scrambled|poached egg|boiled egg|fried egg|benedict|shakshuka|smoothie|brunch|bircher|kedgeree|omelet|crumpet/],
  ['dessert', /\bdessert|(?<!yorkshire )pudding|sponge\b|(?<!pan|fish)cakes?\b|(lemon|treacle|chocolate|apple|bakewell|custard|fruit|berry|strawberry|raspberry|pear|plum|frangipane|pecan|jam|tarte) tart|tatin|crumble|cheesecake|brownie|mousse|ice[- ]?cream|sorbet|trifle|pavlova|meringue|souffl[eé]|panna cotta|tiramisu|fool\b|sundae|parfait|cr[eè]me br[uû]l[eé]e|custard|choc(olate)? pot|roulade|eton mess|sticky toffee|bread and butter pudding|clafoutis|semifreddo|baklava|jelly/],
  ['baking', /\bbread|loaf|\bbuns?\b|scone|muffin|cookie|biscuit|flapjack|shortbread|brownie|cupcake|focaccia|sourdough|bagel|brioche|rolls?\b|(?<!pan|fish)cakes?\b|tray ?bake bars|blondie/],
  ['sides', /\bmash\b|mashed|chips\b|fries\b|wedges|gratin|dauphinoise|coleslaw|roast potatoes|side\b|greens\b|slaw|yorkshire pudding|stuffing|pilaf|pilau|rice salad|naan|chapati|roti/],
  ['sauces', /\bsauce|dressing|gravy|pesto|chutney|relish|salsa\b|mayonnaise|mayo\b|vinaigrette|dip\b|ketchup|jam\b|marmalade|pickle|raita|tzatziki|houmous|hummus|guacamole|stock\b/],
  ['drinks', /\bsmoothie|juice|lemonade|cocktail|mocktail|milkshake|\btea\b|coffee|latte|cordial|punch\b|spritz/],
  ['snacks', /\bsnack|crisps|popcorn|energy balls?|bites\b|nibbles|canap|dip\b|toastie|sandwich|bruschetta|crostini/],
  ['light lunch', /\bsandwich|toastie|wrap\b|bruschetta|crostini|frittata|quiche|salad|soup|on toast|bagel|pitta|pita|open sandwich/],
  // cuisine
  ['indian', /\bcurry|tikka|masala|korma|biryani|dhal|dal\b|bhaji|samosa|pakora|tandoori|naan|chapati|jalfrezi|rogan josh|vindaloo|saag|paneer|raita|madras|balti/],
  ['italian', /\bpasta|risotto|pizza|lasagne|lasagna|gnocchi|bruschetta|focaccia|carbonara|bolognese|parmigiana|cacciatore|osso buco|tiramisu|panna cotta|minestrone|arancini|piccata|saltimbocca/],
  ['mexican', /\btaco|burrito|fajita|enchilada|quesadilla|chilli con carne|guacamole|salsa\b|nachos|mole\b|tostada|huevos rancheros/],
  ['asian', /\bstir[- ]?fr|teriyaki|katsu|ramen|pad thai|thai\b|noodle|sushi|dumpling|gyoza|bao\b|sweet and sour|chow mein|satay|laksa|pho\b|bibimbap|kimchi|miso|szechuan|sichuan|hoisin|char siu|massaman|rendang|nasi|udon|soba|tom yum|green curry|red curry|bulgogi/],
  ['middle eastern', /\bshakshuka|falafel|tagine|houmous|hummus|kofta|shawarma|tabbouleh|fattoush|za'?atar|harissa|baba ganoush|freekeh|sumac|labneh|halloumi/],
  ['spanish', /\bpaella|chorizo|tapas|gazpacho|patatas bravas|tortilla espa/],
  ['french', /\bcoq au vin|bourguignon|cassoulet|ratatouille|gratin|dauphinoise|souffl[eé]|tarte|quiche|bouillabaisse|confit|nicoise|cr[eè]me br[uû]l[eé]e|clafoutis/],
  ['british', /\bpie\b|shepherd'?s pie|cottage pie|toad in the hole|fish and chips|bangers|yorkshire pudding|sunday roast|crumble|trifle|scone|hotpot|kedgeree|full english|bubble and squeak|ploughman|eton mess|sticky toffee/],
  // quick wins
  ['quick', /\bquick|speedy|\b(10|15|20)[- ]minute|in minutes|express|easy|fast\b|simple|weeknight|midweek/],
  ['slow cooker', /\bslow[- ]cook|crock ?pot/],
  ['air fryer', /\bair[- ]?fr(y|ied|yer)/],
];

const MEAT_FISH = new Set(['chicken', 'beef', 'lamb', 'pork', 'turkey', 'duck', 'fish', 'seafood']);

export function autoTags(name) {
  const n = ` ${String(name || '').toLowerCase()} `;
  const tags = [];
  for (const [tag, re] of RULES) if (re.test(n)) tags.push(tag);
  // Light vegetarian guess: only for obviously veg-led dishes with no meat/fish keyword.
  if (!tags.some((t) => MEAT_FISH.has(t)) && /\b(veg(gie|etable|etarian)?|vegan|tofu|halloumi|paneer|lentil|chickpea|bean|mushroom|aubergine|squash|cauliflower|spinach)\b/.test(n)) {
    tags.push('vegetarian');
  }
  return tags;
}

// Course tags drive which meal slot a recipe is suitable for.
const NON_MAIN = ['breakfast', 'dessert', 'baking', 'sides', 'sauces', 'drinks', 'snacks'];

export const COURSES = ['starter', 'main', 'dessert', 'side', 'breakfast', 'snack', 'other'];

const PROTEINS = ['chicken', 'beef', 'lamb', 'pork', 'turkey', 'duck', 'fish', 'seafood', 'pulses', 'tofu'];
const MAIN_TYPES = ['curry', 'pasta', 'rice', 'noodles', 'stir-fry', 'pie', 'stew', 'traybake', 'burger', 'pizza', 'tacos & wraps', 'bbq'];
const NOT_PROTEIN = /green beans?|anchov\w*/g;
const OTHER_NAME = /kombucha|kefir|spreads?\b|dressings?\b|tipple|cooler|cordial|lemonade|cocktail|mocktail|juice|butters?\s*$|cashew cream|drizzle\s*$|bouillon/;
const SNACK_NAME = /trail mix|popcorn|crackers?\b|crisps\b|bliss balls?|energy balls?|\bbites\b|flapjacks?|(cereal|granola|protein|energy|fridge) bars?|roasted (chickpeas|nuts)|\b(walnuts|almonds|cashews|pecans|hazelnuts|pistachios|peanuts|nuts)\b.*\b(salt|spice|paprika|chilli|thyme|rosemary|herbs?)/;
const DESSERT_FORM = /\bfool\b|granita|sorbet|frozen yog|ice cream/;
const BAKE_NAME = /muffins?|scones?|biscuits?|cookies?|\bbread\b|loaf|\bbuns?\b/;;
const STRONG_SWEET = /chocolate|\bfruit|(lime|lemon|orange|mango|coconut|rhubarb|banana|passion ?fruit).*\btart\b|ganache|frosting|icing|truffle|fudge|chia pots?|compote|\bbars\b|baked (pears?|apples?)|jelly/;
const WEAK_SWEET = /caramel|toffee|sweet(?! potato)|honey|maple|berr(y|ies)|cream.*(fruit|apricot|peach|plum|cherr)|(fruit|apricot|peach|plum|cherr).*cream/;
const STARTER_NAME = /\bsoup|broth|chowder|bisque|gazpacho|minestrone|p[aâ]t[eé](?![a-z])|terrine|bruschetta|crostini|canap|prawn cocktail|carpaccio|\bdips?\b/;
const MAIN_NAME = /\bbake\b|casserole|risotto|dahl|bolognese|chilli|fillets?\b|nut roast|parmigiana|\bmac\b.*cheese|frittata|quiche|baked eggs/;

export function guessCourse(name, tags = []) {
  const n = String(name || '').toLowerCase();
  const t = new Set(tags.map((x) => x.toLowerCase()));
  const fromName = new Set(autoTags(n.replace(NOT_PROTEIN, '')));
  const isMain = PROTEINS.some((p) => t.has(p) && fromName.has(p)) || MAIN_TYPES.some((m) => t.has(m)) || MAIN_NAME.test(n);
  if (DESSERT_FORM.test(n)) return 'dessert';
  if (SNACK_NAME.test(n) && !STARTER_NAME.test(n)) return 'snack';
  if (OTHER_NAME.test(n)) return 'other';
  if (t.has('dessert') || STRONG_SWEET.test(n)) return 'dessert';
  if (STARTER_NAME.test(n)) return 'starter';
  if (BAKE_NAME.test(n)) return 'other';
  if (t.has('breakfast')) return 'breakfast';
  if (isMain) return 'main';
  if (WEAK_SWEET.test(n)) return 'dessert';
  if (t.has('snacks')) return 'snack';
  if (['baking', 'sauces', 'drinks'].some((c) => t.has(c))) return 'other';
  return 'side';
}

export function mealFits(recipe, meal) {
  const t = new Set(recipe.tags.map((x) => x.toLowerCase()));
  if (recipe.course) return courseFits(recipe.course, t, meal);
  const isMain = t.has('main') || !NON_MAIN.some((c) => t.has(c));
  switch (meal) {
    case 'starter':
      return t.has('soup') || /\bsoup|p[aâ]t[eé](?![a-z])|\bdips?\b|terrine|bruschetta|crostini/i.test(recipe.name);
    case 'breakfast':
      return t.has('breakfast');
    case 'lunch':
      return t.has('lunch') || t.has('light lunch') || t.has('soup') || t.has('salad') || (isMain && !t.has('roast'));
    case 'dessert':
      return t.has('dessert') || (t.has('baking') && /cake|brownie|tart|blondie/i.test(recipe.name));
    case 'snack':
      return t.has('snacks') || t.has('baking');
    case 'dinner':
    default:
      return isMain;
  }
}

function courseFits(course, t, meal) {
  switch (meal) {
    case 'starter':
      return course === 'starter';
    case 'breakfast':
      return course === 'breakfast' || t.has('breakfast');
    case 'lunch':
      return course === 'main' || course === 'starter' || t.has('light lunch') || t.has('soup') || t.has('salad');
    case 'dessert':
      return course === 'dessert';
    case 'snack':
      return course === 'snack';
    default:
      return course === 'main';
  }
}

// Score how "lunchy" a recipe is, so lunches lean towards soups and salads.
export function mealAffinity(recipe, meal) {
  const t = new Set(recipe.tags.map((x) => x.toLowerCase()));
  if (meal === 'lunch') return t.has('light lunch') || t.has('soup') || t.has('salad') || t.has('lunch') ? 3 : 1;
  if (meal === 'dinner') return t.has('light lunch') ? 0.4 : 1;
  return 1;
}

export const MAIN_INGREDIENTS = ['chicken', 'beef', 'lamb', 'pork', 'turkey', 'duck', 'fish', 'seafood', 'eggs', 'pulses', 'tofu', 'cheese', 'mushroom'];

export function mainIngredient(recipe) {
  const t = recipe.tags.map((x) => x.toLowerCase());
  return MAIN_INGREDIENTS.find((m) => t.includes(m)) || (t.includes('vegetarian') ? 'veg' : 'other');
}
