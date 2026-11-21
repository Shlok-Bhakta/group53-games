import { settingsOf, type ModeKey, type Settings } from "../../../convex/modes";
import { CHALLENGE_PENALTY, KNOCKOUT_POINTS, UNO_PENALTY } from "../../../convex/uno/engine";
import { unoRules } from "../../../convex/uno/modes";

export function unoRulesText(mode: ModeKey, raw: Settings): string[] {
  const r = unoRules(mode, settingsOf(mode, raw));
  const noMercy = r.deck === "nomercy";
  const out: string[] = [
    `Everyone gets ${r.hand} cards${r.decks > 1 ? " from two decks shuffled together" : ""}. On your turn, play a card that matches the top card's color, number or symbol, or a wild. Play whenever: you get a push when it's your turn.`,
    noMercy
      ? "The No Mercy deck has 168 cards: numbers, Skip, Skip Everyone, Reverse, Draw 2, Draw 4, Discard All, and the wilds Reverse Draw 4, Draw 6, Draw 10 and Color Roulette."
      : "Skip jumps the next player, Reverse turns play around (with two of you it's a skip), Draw 2 makes the next player draw two and miss their go. A wild sets the color; a Wild Draw 4 also makes the next player draw four.",
  ];
  if (noMercy)
    out.push(
      "Skip Everyone gives you another go. Discard All lets you drop every card of its color with it. Color Roulette makes the next player name a color and flip cards till they find it, keeping every one.",
    );
  out.push(
    r.drawUntil
      ? "Can't play? Keep drawing until you can, then play it."
      : `Can't play? Draw one. If it fits you may play it${r.forcePlay ? " (and you must)" : ", or keep it"}.`,
  );
  if (r.forcePlay) out.push("If you can play, you have to: no drawing to hold cards back.");
  if (r.stack)
    out.push(
      r.stack === 1
        ? "Stacking: answer a draw card with the same card to pass the total on. Whoever can't stack takes it all."
        : "Stacking: answer a draw card with any draw card worth the same or more, and the total moves on. Whoever can't stack takes it all.",
    );
  if (r.challenge)
    out.push(
      `A Wild Draw 4 is only fair when you hold nothing of the current color. Hit with one, you can challenge: caught bluffing, they draw the four; played fair, you draw ${4 + CHALLENGE_PENALTY}.`,
    );
  if (r.sevenZero) out.push("Play a 7 and you swap hands with anyone you pick. Play a 0 and every hand passes to the next player along.");
  if (r.jumpIn) out.push("Jump-in: holding the exact same card as the top one, play it any time, even off turn. Play carries on from you.");
  if (r.unoCall)
    out.push(
      `Playing down to one card? Tap UNO! first. Forget, and anyone can catch you for ${UNO_PENALTY} cards until the next move, unless you call it in time.`,
    );
  if (!r.powerFinish) out.push("You can't go out on an action card or a wild: your last card has to be a number.");
  if (r.mercy) out.push(`Mercy rule: reach ${r.mercy} cards and you're out of the hand.`);
  out.push(
    r.goal
      ? `Go out to win the hand and score everyone else's cards: numbers at face value, actions 20, wilds 50${r.mercy ? `, plus ${KNOCKOUT_POINTS} for each player the mercy rule knocked out` : ""}. First to ${r.goal} wins.`
      : "First to empty their hand wins. Everyone else is ranked by the points left in their hand.",
  );
  return out;
}
