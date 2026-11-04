import type { State } from "./engine";

// Journey Across Mereddia's talking: every conversation as a small graph of nodes. A node says who
// speaks, what they say, where it goes next (or what the player can answer), and may run an effect
// when it's shown. The state only remembers the node's id, so a half-finished conversation saves fine.
//
// The lines come from the project's own dialogue and lore files. Where there was nothing written yet,
// the text is marked "(draft)" below so it's easy to find and replace.

export type Who = "narrator" | "note" | "mallakoth" | "vastios" | "wilfred" | "drawf" | "master" | "stefan" | "alexis" | "clavicus" | "joshua" | "ricky";

export const NAMES: Record<Who, string> = {
  narrator: "",
  note: "",
  mallakoth: "Mallakoth",
  vastios: "Vastios",
  wilfred: "Wilfred",
  drawf: "Drawf",
  master: "The Secret Master",
  stefan: "Stefan",
  alexis: "Alexis",
  clavicus: "Clavicius",
  joshua: "Joshua",
  ricky: "Ricky",
};

export type Choice = { label: string; to?: string; fx?: string };
export type Node = {
  who: Who;
  text: string | ((s: State) => string);
  next?: string;
  choices?: Choice[] | ((s: State) => Choice[]);
  // An effect to run when the node is shown. See runFx in the engine.
  fx?: string;
  // A cutscene to play before this node is shown. See cutscenes.ts.
  scene?: string;
};

const say = (who: Who, text: Node["text"], next?: string, extra: Partial<Node> = {}): Node => ({ who, text, next, ...extra });

// The shelves in the sanctum, in order. The Secret Master gives hints about the lore in his own way.
export const LORE: string[] = [
  "\"For the defense of humanity against the extended threat of demons emerging from the Underworld, an order must be established around the recently discovered Sacred Flame. The knightly force shall be known as the Lightbringers, while the keepers of knowledge shall bear the title Keepers of the Sacred Flame.\"\n\n— Sir Atronius, Sacred Flame Codex, page 1",
  "\"Whenever the hero Morgan pleaded with the Gods to grant the people a means to defeat the demonic threat plaguing the continent of Mereddia, the Gods responded. They bestowed magical abilities upon a select few, but these gifts came at a cost. The powers are bound to the Sacred Flame, a force so potent that, should it fall into the hands of the demons, it would spell the end of humanity.\"\n\n— Seer/Historian Callingius",
  "\"This is alarming news; the cult known as The Liberators intends to bring demons back from the Underworld. We are gravely unprepared to face the consequences if they succeed. To prevent this catastrophe, I will infiltrate their ranks and attempt to dismantle the cult from within. For the sake of the mission, I must preserve my anonymity.\"\n\n— Message brought by a Lightseer pigeon from an anonymous source",
  "\"The full ramifications of the demons' uprising from The Great Expanse were not immediately understood. While the most obvious consequence was the massive loss of life caused by the demons, a far greater issue emerged; one that disrupted the very balance of the world. The act of summoning the demons destabilized the natural order, and as a result, the magic that once thrived across the land was severely weakened. For those who retained magic, it became nearly useless, unable to function as it once had. However, most people lost their magical abilities entirely, marking the beginning of an era in which magic was no longer a reliable force in the world.\"\n\n— Unknown source",
  "Dear Master Willard,\nI must admit that I do not fully trust the members of the Order of the Magical Eye. While they champion the defense of the common people through magical intervention, it seems to me that they are far too quick to embrace drastic measures simply on the chance they might succeed. This reckless approach has come at a great cost, I have lost many friends because of their actions.\nSincerely,\nVeteran Lightbringer Shawn",
  "\"A mysterious and remarkable order, known only by the symbol of a 'W', is said to gather deep within the Whispering Woods. These enigmatic figures are rarely seen, yet tales persist of their strange ritual: they await adventurers bearing axes; those who dare to fell the forest's ancient trees. Together, they haul the timber to fuel an immense bonfire, one so vast it sends plumes of smoke spiraling into the heavens, blotting out the sky in ash and shadow.\"\n\n— Excerpt from Happenings Across The Land",
  "Test 5\nI know I am close to banishing the demons back to The Great Expanse. This round of experiments has shown that I can banish a creature back to that cursed dimension in a way that prevents it from returning. For the next round of testing, I plan to find a minor demon and experiment on it.",
  "\"The battle was going well; we were winning until the Parkan wizards unleashed their antimatter magic. We thought retreat and our heavy casualties would be the worst parts of that day. Then the ground started rumbling and a hole to the Underworld opened up.\"\n\n— Excerpt from a Loudousani army captain",
];

// What the note does once it's alive. (draft) Replace with the real list.
export const NOTE_QUIPS: string[] = [
  "The note flaps one corner at you. \"Eyes up here.\"",
  "The note slides off the table, lands face down, and refuses to be picked up.",
  "The note folds itself into a tiny paper boat and sails across the table.",
  "\"I'm not a note anymore,\" the note announces. \"I'm a lifestyle.\"",
  "The note reads itself aloud, gets bored halfway, and starts over.",
  "The note tries to bite your finger. It's paper. It tickles.",
  "The note does a little paper cartwheel and bows.",
  "\"Don't look at me,\" says the note. \"I'm in a mood.\"",
];

// The trail sign reads differently depending on which way you face it.
const SIGN: Record<string, string> = {
  down: "Town of Dresden <-\nUnyielding Mountains ->\nSlime Fields - Backwards",
  up: "Town of Dresden ->\nUnyielding Mountains <-\nSlime Fields - Forwards",
  right: "Town of Dresden - Forwards\nUnyielding Mountains - Backwards\nSlime Fields <-",
  left: "Town of Dresden - Backwards\nUnyielding Mountains - Forwards\nSlime Fields ->",
};

// What Drawf says depending on how far along you are. He's the straight man, so he's patient about it.
export function drawfAdvice(s: State): string {
  if (s.flags.trialStarted) return "Vastios is waiting. Don't keep him waiting.";
  if (s.flags.leversDone) return "Vastios said he'd meet us outside. Look for him near the path east of the river.";
  if (s.zone === "sanctum") {
    if (!s.flags.vastiosGone) return "Vastios said to talk to him when you're ready. He'll explain the levers. Try not to wink back.";
    return "He's gone to wait outside. Pull the lever on the left wall to open the way out. I would rather not be sealed in here with you.";
  }
  if (s.flags.puzzleDone) return "The sanctum door is open. Quickly, before it shuts.";
  if (s.flags.armed) return "The gold button woke something. The red button at the bottom of the right wall should do the rest. Be fast about it.";
  if (s.flags.drawfJoins) return "Follow the true flame, not the false ones. The blue button at the bottom of the left wall, then the gold one. Wrong ones bite.";
  return "The Temple door is right there. Let's get inside.";
}

export const NODES: Record<string, Node> = {
  // ------------------------------------------------------------------ the field
  intro1: say("narrator", "Mallakoth wakes in a quiet field, west of the Unyielding Mountains. A carrier pigeon drops out of the sky and lets a letter fall into his hands.", "intro2"),
  intro2: say(
    "note",
    "Mallakoth,\n\nI hope this letter reaches you in time. It has been too long since we last spoke, but there is no time for pleasantries. The break is over, and the Lightbringers need all the help they can get. The demonic forces grow bolder with each passing day, their attacks relentless. We cannot afford hesitation.\n\nMeet me in the Valley of Time, deep within the Unyielding Mountains. The path will be treacherous, but you knew this when you became an apprentice Lightbringer. You swore your allegiance, and now the time has come to prove it.\n\nI will be waiting, but do not delay, every moment counts.\n\n— Vastios",
    "intro3",
  ),
  intro3: {
    who: "note",
    text: "p.s. This poem will be useful for you:\n\nFollow the true and the fake flame.\nFor you have much to gain.\nChoosing the wrong option\nCould bring your destruction.\n\n———— burn this letter when you are done with it ————",
    choices: [
      { label: "Burn the letter", to: "intro4", fx: "burnLetter" },
      { label: "Read it once more", to: "intro2" },
    ],
  },
  intro4: say("narrator", "You burn the letter, as instructed. The pigeon coos once and flies off. The Temple of the Sacred Flame lies somewhere in the Unyielding Mountains, to the east of here."),
  // ------------------------------------------------------------------ the field: the axe, the tree, the pigeon
  axe_get: say("narrator", "An axe is buried in the old stump, its handle worn smooth. You pull it free. Axe added to inventory.", undefined, { fx: "takeAxe" }),
  axe_stump: say("narrator", "There is nothing special about this stump."),
  tree_nope: say("narrator", "A tall, crooked tree. A pigeon watches you from a high branch, looking quietly smug. You'd need an axe to do anything about it."),
  gate_open: { who: "narrator", text: "The iron gate is locked, and the golem's key fits the lock. Open the gate?", choices: [{ label: "Use the key.", fx: "openGate" }, { label: "Not yet." }] },
  pick_take: { who: "narrator", text: "A rusty pickaxe is wedged in the rock. It looks like it could be pulled free. Take it?", choices: [{ label: "Take the pickaxe.", fx: "takePick" }, { label: "Leave it." }] },
  tree_poke: say("narrator", "You lift the axe. Before you can swing, the pigeon dives off the branch and pecks you right on the head. Ow!", undefined, { fx: "pigeonPoke" }),
  tree_repeck: say("narrator", "Just as the axe comes down, the pigeon dives again and pecks you on the head. Again!", undefined, { fx: "pigeonPoke" }),
  pigeon_back: say("narrator", "The pigeon flutters back up to its branch and glares at you. Fine. You can swing now."),
  tree_down: say("narrator", "With a last crack the old tree topples. A nest tumbles out of the branches: coins and a potion, hidden for who knows how long.", undefined, { fx: "treeDown" }),
  tree_chop: say("narrator", "Chop! Bark flies. The tree shudders."),
  trail_sign: say("narrator", (s) => SIGN[s.facing]),
  edge_east: say("narrator", "You have no reason to go to Dresden at this time."),
  go_dresden: { who: "narrator", text: "The road east runs on to Dresden. Walk there?", choices: [{ label: "Yes.", fx: "travel" }, { label: "Not yet." }] },
  spike_hatch: { who: "narrator", text: "Behind Stefan's dead end, a floorboard is loose. Beneath it, a narrow chamber, its floor pocked with little holes. Step down?", choices: [{ label: "Step down.", fx: "travel" }, { label: "Leave it." }] },
  spikes_in: say("narrator", "The floor ticks and clicks beneath your boots. Something is about to rise out of those holes. Run for the far end!"),
  spikes_out: say("narrator", "You tumble out the far side as the spikes slam up behind you. In a crack by the wall: a forgotten purse, and a potion."),
  edge_north: say("narrator", "(draft) The road north leads to the Slime Fields. You'll be taken there when the time comes."),
  spring_in: { who: "narrator", text: "Warm, pale light shimmers on a sunken pool, and a man sits in it with his eyes shut, humming. The water is magical. Step into the spring?", choices: [{ label: "Step in.", fx: "travel" }, { label: "Not now." }] },
  spring_out: { who: "narrator", text: "Climb out of the spring?", choices: [{ label: "Climb out.", fx: "travel" }, { label: "Stay a while." }] },
  go_caves: {
    who: "narrator",
    text: "Do you want to go towards the Unyielding Mountains?",
    choices: [{ label: "Yes.", fx: "travel" }, { label: "No." }],
  },

  // ------------------------------------------------------------------ the caves
  sm_first1: say("master", "Welcome, Adventurer.", "sm_first2", { fx: "metMaster" }),
  sm_first2: say("mallakoth", "Who are you?", "sm_first3"),
  sm_first3: {
    who: "master",
    text: "They call me the Secret Master. I can be found all across the land, and whoever can find me gets a reward.",
    choices: [
      { label: "Neat.", to: "sm_first_end" },
      { label: "Does this mean I get a reward?", to: "sm_first_hint" },
    ],
  },
  sm_first_end: say("master", "Neat indeed. We will meet again, I think."),
  sm_first_hint: say("master", (s) => `Not this time, but I will give you a hint: ${s.quiz.ans.join("")}. And dodge. Remember to dodge.`),
  sm_again: say("master", (s) => `Seek out the hidden places, adventurer. Remember: ${s.quiz.ans.join("")}. And dodge.`),
  stefan1: say("stefan", "Another dead end, dammit.", "stefan2"),
  stefan2: say("stefan", "...Although. That floorboard by the wall is awfully loose. Don't tell anyone I said so.", undefined, { fx: "metStefan" }),
  hatch_hidden: say("narrator", "A dead end, and a man muttering to himself nearby. Nothing else here. Perhaps have a word with him."),
  joshua1: say("joshua", "Bold choice. Questionable execution."),
  alexis1: say("alexis", "*contented sigh*"),
  clavicus1: say("clavicus", "I've never seen crystals like these, they feel magical."),
  lost1: {
    who: "narrator",
    text: "An unmarked tunnel twists off into the dark. Would you like to continue?",
    choices: [{ label: "Yes, it might be a shortcut.", fx: "lost" }, { label: "No, it might be dangerous.", to: "lost_no" }],
  },
  lost_no: say("narrator", "You decide against wandering the path. Better safe than sorry."),
  golem_nope: say("narrator", "The golem's hide is solid rock. Your fists would break long before it does. There must be a tool somewhere in this hollow."),
  golem_down: say("narrator", "One swing. The pickaxe finds the seam in the stone and the golem comes apart like a dropped plate. Something glints in the rubble: an iron key.", undefined, { fx: "golemDown" }),

  // ------------------------------------------------------------------ the valley
  drawf1: {
    who: "drawf",
    text: "Hello Mallakoth, are you the second person that Vastios specified?",
    choices: [
      { label: "Yes, that's me. I got the message from Vastios.", to: "drawf_yes" },
      { label: "No, what is this place? I got lost and I stumbled here.", to: "drawf_no" },
    ],
  },
  drawf_yes: say("drawf", "There is no one I would rather work with. Let's get inside the Temple, I want to find out what Vastios wants.", "drawf_yes2"),
  drawf_yes2: say("mallakoth", "Same buddy, same. Let's go.", undefined, { fx: "drawfJoins" }),
  drawf_no: {
    who: "drawf",
    text: "This is the center of humanity's hope and you just stumbled across it?",
    choices: [{ label: "Nah, I had you fooled for a second though, didn't I?", to: "drawf_no2" }],
  },
  drawf_no2: say("drawf", "You tell yourself that.", "drawf_no3"),
  drawf_no3: say("mallakoth", "It actually wasn't that hard, they really need to up the security.", "drawf_no4"),
  drawf_no4: say("narrator", "Drawf glares at you. \"I hate you so much.\"", undefined, { fx: "drawfJoins" }),
  drawf_advice: say("drawf", (s) => drawfAdvice(s)),
  mtn_btn: say("narrator", "A button the exact colour of the mountain, easy to miss. You press it. Somewhere in the rock, something grinds open.", undefined, { fx: "openSecret" }),
  mtn_done: say("narrator", "The button has already been pressed."),

  // ------------------------------------------------------------------ behind the falls
  table1: {
    who: "narrator",
    text: "There is a note on the table. Do you want to read it?",
    choices: [{ label: "Yes.", to: "note1", fx: "readNote" }, { label: "No.", to: "note_no" }],
  },
  note1: say(
    "note",
    "Dear adventurer,\n\nIf you are reading this, you found my little hideaway behind the falls. Five gold coins for your trouble, tucked in the fold.\n\nThe valley wall opposite this one has a button the colour of the mountain. Press it, and we can speak properly.\n\n— The Secret Master",
    "note2",
  ),
  note2: say("narrator", "You take the five gold coins. The note shivers on the table. Then, very slowly, it sits up."),
  note_no: say("narrator", "You leave the note alone."),
  note_q: say("note", ""),
  sign_text: say("narrator", ""),
  keeper_dead: say("narrator", "(draft) A Keeper, long dead, slumped against the wall with a book still open in his lap. Whatever he was reading, it didn't save him."),
  fake_altar: say("narrator", "A shimmering altar of false flame. It looks right, and it feels wrong. Somewhere, the true one is waiting."),
  sm_slimes: {
    who: "master",
    text: "Well well, adventurer. Found me again! Not this time, I'm afraid: the blade first. But I'll give you a hint, and a good one. In the far southeast corner of this field there is a patch of grass that isn't quite grass. Stand on it, and see where it takes you. There is a treehouse, and a free weapon, for the curious.",
    fx: "treeHint",
  },
  sm_slimes2: say("master", "The far southeast corner. A patch of grass that isn't quite grass. Step on it."),
  tree_tele: say("narrator", "The patch of grass hums under your boots. A ring of pale light flares around your feet, the field tilts, and the world spins away.", undefined, { fx: "travel" }),
  lore: say("narrator", ""),

  // ------------------------------------------------------------------ the Secret Master's hideout
  sm_h1: {
    who: "master",
    text: "Welcome, adventurer, to my humble abode. I am sure you have some questions. Ask away.",
    choices: [
      { label: "Who are you?", to: "sm_h_who" },
      { label: "Why are you in this cave?", to: "sm_h_why" },
    ],
    fx: "metMaster",
  },
  sm_h_who: {
    who: "master",
    text: "Why, I am the Secret Master, of course.",
    choices: [{ label: "So you were the one that left that note.", to: "sm_h_note" }, { label: "Why are you in this cave?", to: "sm_h_why" }],
  },
  sm_h_note: say("master", "Yes, that was me.", "sm_h_why_ask"),
  sm_h_why_ask: { who: "master", text: "Anything else?", choices: [{ label: "Why are you in this cave?", to: "sm_h_why" }, { label: "I'd like the prize.", to: "sm_h_offer" }] },
  sm_h_why: {
    who: "master",
    text: "I wait for adventurers such as yourself to find me, and then I give them free stuff.",
    choices: [{ label: "Isn't that a little, creepy?", to: "sm_h_offer" }, { label: "Free stuff? Go on.", to: "sm_h_offer" }],
  },
  sm_h_offer: {
    who: "master",
    text: "I can't tell you what to think, but I offer prizes to adventurers such as yourself, who can find me. Do you want it?",
    choices: [
      { label: "Accept it.", to: "sm_h_give" },
      { label: "Reject it.", to: "sm_h_no", fx: "rickyNo" },
      { label: "This is too weird for me. I am out.", to: "sm_h_out" },
    ],
  },
  sm_h_give: say("master", "Ricky, wake up!", "sm_h_give2", { fx: "giveRicky" }),
  sm_h_give2: say("narrator", "A chest on little wooden legs creaks awake, stretches, and bounces over to stand beside you. Ricky the Chest will carry your potions, and follow you everywhere. Except into buildings; he gets shy."),
  sm_h_no: say("master", "Your loss."),
  sm_h_out: say("narrator", "You walk away from the conversation, but you feel you are missing something."),
  sm_ret1: say("master", "Welcome back, adventurer. I have a prize for you this time.", "sm_ret2"),
  sm_ret2: say("mallakoth", "What is it?", "sm_ret3"),
  sm_ret3: {
    who: "master",
    text: "It's a walking chest that can store your stuff. Do you want it?",
    choices: [
      { label: "Yes. This reward sounds interesting.", to: "sm_h_give" },
      { label: "Nope. I don't really need it.", to: "sm_ret_no", fx: "rickyNo" },
    ],
  },
  sm_ret_no: say("master", "Your loss. This was a one-time deal."),
  sm_has: say("master", "Ricky is yours. Feed him potions, not coins. He's shy of buildings, so don't take it personally."),
  sm_declined: say("master", "I told you: a one-time deal. But do keep looking for me. I turn up in odd places."),

  // ------------------------------------------------------------------ the temple and the sanctum
  sanct1: say("vastios", "Congratulations boys, you made it to the area that houses the sacred altar.", "sanct2"),
  sanct2: say("vastios", "You kids are closer to being fully fledged members of the Order and I for one could not be more proud.", "sanct3"),
  sanct3: say("vastios", "I will accompany you, Mallakoth, towards your final trial.", "sanct4"),
  sanct4: say("vastios", "Mallakoth, once you are ready, talk to me and I will tell you how to navigate this room.", "sanct5"),
  sanct5: say("wilfred", "I tell you the same thing, young Drawford. However, the first part of your mission will take place in this very room."),
  wilfred1: say("wilfred", (s) => (s.flags.trialStarted ? "One final step, young Mallakoth, then you will be a fully fledged Lightbringer." : "Young Mallakoth, your final trial will be perilous, but I know you will be successful in your endeavor.")),
  vl1: say("vastios", "This lever to my left is needed to raise the sacred altar, and it unlocks a secret. *winks*", "vl2"),
  vl2: say("vastios", "Now the lever to my right lowers the altar and lets you leave this room.", "vl3"),
  vl3: say("vastios", "I will meet you outside, whenever you are ready to start your Lightseer trial.", undefined, { fx: "vastiosLeaves" }),
  vl_remind: say("vastios", "Pull the lever on my right when you're ready to leave. I'll be outside."),
  flame1: say("narrator", "The Sacred Flame burns a deep, steady purple. Its warmth reaches you from several paces away. Not yet, you think. Not yet."),
  shelf_empty: say("narrator", "The shelf is full of old, dry books. You've already read the one worth reading."),

  // ------------------------------------------------------------------ the slime fields
  vvalley1: say("vastios", "(draft) Ready? Hold on to something. This is where your trial begins.", undefined, { fx: "toSlimes" }),
  vslime1: say("vastios", "We made it. Your final trial. This is your trial to complete alone. But I will tell you this: collect the Lightbringer blade from the statue of Atronius."),
  vslime_again: say("vastios", "The blade is in the statue of Atronius. Ask it if you are worthy."),
  statue1: {
    who: "narrator",
    text: "You examine the plaque at the base of the statue. It reads: Are you worthy?",
    choices: [{ label: "Yes.", to: "statue_yes", fx: "statueYes" }, { label: "No.", to: "statue_no" }],
  },
  statue_again: {
    who: "narrator",
    text: "Are you worthy?",
    choices: [{ label: "Yes.", to: "statue_yes", fx: "statueYes" }, { label: "No.", to: "statue_no" }],
  },
  statue_no: say("narrator", "You feel some energy emanating from the statue, but in the end nothing happens.", undefined, { fx: "statueNo" }),
  statue_yes: say("narrator", "Light pours from the statue's raised hands. A sword of white-gold lands in yours: the Lightbringer blade. Across the fields, slimes begin to stir. Hundreds of years of them.", undefined),
  statue_done: say("narrator", "The statue stands silent, its work done."),

  // ------------------------------------------------------------------ the treehouse
  tree1: say("master", "Welcome to my treehouse, adventurer! You found me again. A free weapon for you, and my shop is open. Browse.", "tree_menu"),
  tree_menu: {
    who: "master",
    text: (s) => (s.flags.freeWeapon ? "What can I do for you?" : "Take one weapon, on the house."),
    choices: (s) => {
      const out: Choice[] = [];
      if (!s.flags.freeWeapon) {
        out.push({ label: "Hunter's Bow", fx: "take:bow", to: "tree_given" });
        out.push({ label: "Polearm", fx: "take:polearm", to: "tree_given" });
        out.push({ label: "Woodsman's Axe", fx: "take:axe", to: "tree_given" });
      }
      if (s.items.prismGel && !s.weapons.includes("prism")) out.push({ label: "Show him the Prism Gel", fx: "take:prism", to: "tree_prism" });
      out.push({ label: "Potion (8 gold)", fx: "buy:potion", to: "tree_menu" });
      out.push({ label: "Antidote (6 gold)", fx: "buy:antidote", to: "tree_menu" });
      out.push({ label: "Elixir (12 gold)", fx: "buy:elixir", to: "tree_menu" });
      out.push({ label: "Leave" });
      return out;
    },
  },
  tree_given: say("master", "A fine choice. Treat it well.", "tree_menu"),
  tree_prism: say("master", "Rainbow gel! I have waited years for one of these. Hold still. This will not hurt, much.", "tree_menu"),

  // ------------------------------------------------------------------ the oath
  oath0: say("narrator", "A couple of months later, in the sanctum of the Temple of the Sacred Flame. Purple light on old stone. Four figures stand around the altar.", "oath1"),
  oath1: say("wilfred", "Do you, Drawford Crampton, accept the responsibilities of a Keeper of the Sacred Flame, maintaining the fire of the Lightbringers alive and being a source of knowledge for as long as you are active?", "oath2"),
  oath2: say("drawf", "Yes, I swear by the sacred flame.", "oath3"),
  oath3: {
    who: "vastios",
    text: "And do you, Mallakoth Andorus Luminus, accept the responsibilities of a Lightbringer, bringing the light of the sacred flame into the people's hearts and protecting innocents from the influence of evil?",
    choices: [
      { label: "Yes, I swear by the sacred flame.", to: "oath4" },
      { label: "I am not ready for all this responsibility.", to: "oath_wait" },
    ],
  },
  oath_wait: say("vastios", "(draft) Take your time, Mallakoth. The flame will wait. It always has.", "oath3"),
  oath4: say("wilfred", "Now both of you must put your hand inside the sacred flame. May the scarring show your allegiance to the order.", "oath5"),
  oath5: say("narrator", "Wilfred and Vastios already carry the scars, pale against the purple light. Drawf goes first, jaw tight. Mallakoth follows. The flame doesn't feel like fire. It feels like a decision.", "oath6", { scene: "flame" }),
  oath6: say("narrator", "(draft) The robes come out: white and gold for the Lightbringer, deep bronze for the Keeper. They are heavier than they look.", "oath7", { scene: "robes" }),
  oath7: say("drawf", "What are you going to do now?", "oath8"),
  oath8: say("mallakoth", "I need to go on a journey.", "oath9"),
  oath9: say("drawf", "Across Mereddia?", "oath10"),
  oath10: say("mallakoth", "No, to Dresden. That's where my mission takes me.", "oath11"),
  oath11: say("drawf", "You're going home then. Say hi to your parents for me.", "oath12"),
  oath12: {
    who: "narrator",
    text: "End of Arc 0. Ready to start Chapter 1?",
    choices: [{ label: "Yes, I am ready.", to: "ch1_wait" }, { label: "Not yet.", to: "ch1_not" }],
  },
  ch1_wait: say("narrator", "Well, I am not. You will have to wait a bit.", undefined, { fx: "win" }),
  ch1_not: say("narrator", "Updates soon. If you want to play some more, you can always start a new playthrough.", undefined, { fx: "win" }),
};
