export const MODULE_ID = "mk-shadowdark-crafting";

export const FLAGS = {
  IS_RECIPE: "isRecipe",
  RECIPE: "recipe",
  RECIPE_BOOK_ID: "recipeBookId",
  CRAFTED: "crafted"
};

export const TEMPLATES = {
  CRAFTING_APP: `modules/${MODULE_ID}/templates/crafting-app.hbs`,
  RECIPE_EDITOR: `modules/${MODULE_ID}/templates/recipe-editor.hbs`,
  CHAT_CARD: `modules/${MODULE_ID}/templates/chat-card.hbs`,
  RECIPE_BOOK_MANAGER: `modules/${MODULE_ID}/templates/recipe-book-manager.hbs`
};

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

export const DEFAULT_BOOK_ID = "world-recipes";

// Legacy fallback only. Runtime system-declared item types should be preferred.
export const SHADOWDARK_V350_ITEM_TYPES = [
  "Ancestry",
  "Armor",
  "Background",
  "Basic",
  "Boon",
  "Class Ability",
  "Class",
  "Deity",
  "Effect",
  "Gem",
  "Language",
  "NPC Attack",
  "NPC Feature",
  "NPC Special Attack",
  "Patron",
  "Potion",
  "Property",
  "Scroll",
  "Spell",
  "Talent",
  "Wand",
  "Weapon"
];

export const ITEM_TYPE_ALIASES = {
  ancestry: "Ancestry",
  armor: "Armor",
  armors: "Armor",
  shield: "Armor",
  shields: "Armor",
  background: "Background",
  basic: "Basic",
  basics: "Basic",
  gear: "Basic",
  item: "Basic",
  items: "Basic",
  loot: "Basic",
  material: "Basic",
  materials: "Basic",
  misc: "Basic",
  treasure: "Basic",
  boon: "Boon",
  class: "Class",
  "class ability": "Class Ability",
  deity: "Deity",
  effect: "Effect",
  effects: "Effect",
  gem: "Gem",
  gems: "Gem",
  language: "Language",
  languages: "Language",
  "npc attack": "NPC Attack",
  "npc feature": "NPC Feature",
  "npc special attack": "NPC Special Attack",
  patron: "Patron",
  potion: "Potion",
  potions: "Potion",
  property: "Property",
  properties: "Property",
  scroll: "Scroll",
  scrolls: "Scroll",
  spell: "Spell",
  spells: "Spell",
  talent: "Talent",
  talents: "Talent",
  wand: "Wand",
  wands: "Wand",
  weapon: "Weapon",
  weapons: "Weapon",
  melee: "Weapon",
  ranged: "Weapon"
};

export const DEFAULT_RECIPE = {
  id: "",
  bookId: DEFAULT_BOOK_ID,
  enabled: true,
  craftType: "basic",
  outputName: "New Crafted Item",
  outputUuid: "",
  outputSourceMode: "snapshot",
  outputType: "Basic",
  category: "",
  outputImg: "icons/svg/item-bag.svg",
  outputQty: 1,
  outputItemData: null,
  dc: 12,
  ability: "int",
  abilities: ["int"],
  time: "1 hour",
  toolRequired: "",
  stationRequired: "",
  materialGroups: [],
  materials: [],
  deconstructEnabled: true,
  deconstructGenerated: false,
  deconstructMaterials: [],
  goldCost: 0,
  failureMode: "partial-loss",
  notes: ""
};