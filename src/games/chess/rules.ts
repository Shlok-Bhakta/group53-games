import type { ModeKey, Settings } from "../../../convex/modes";

const days = (hours: number) => (hours === 24 ? "a day" : `${hours / 24} days`);
const secs = (n: number) => `${n} second${n === 1 ? "" : "s"}`;
const speed = (ticksPerSquare: number) => (ticksPerSquare === 30 ? "1 square a second" : ticksPerSquare < 30 ? "2 squares a second" : "1 square every 1.5 seconds");

// How to play each chess mode, with the game's settings filled in.
export function chessRules(mode: ModeKey, s: Settings): string[] {
  switch (mode) {
    case "chess:classic":
      return [
        "Normal chess, one move at a time.",
        "We ping you when it's your move, and again every 8 hours if you forget.",
        ...(s.moveTime ? [`Sit on your move for ${days(s.moveTime)} and you lose on time.`] : []),
        "Offer a draw or resign from under the board.",
      ];
    case "chess:four":
      return [
        "Red, blue, yellow and green take turns clockwise. Your army is always at the bottom of your screen.",
        "Captures score points: pawn 1, knight 3, bishop or rook 5, queen 9. Queens made by promotion are worth 1.",
        "Check two kings with one move for +5, all three for +20.",
        "Checkmate someone for +20. If you have no legal move and aren't in check, you're out but get +20.",
        "Knocked-out armies turn grey. Their pieces still block, and taking them scores nothing.",
        "Pawns promote to a queen on the middle line.",
        "It ends when one player is left, or after 50 quiet rounds (+10 each to everyone still in). Most points wins.",
        `Sit on your move for ${days(s.moveTime ?? 48)} and you time out.`,
      ];
    case "chess:realtime":
      return [
        "No turns. Move any piece whenever it's ready.",
        `Pieces travel ${speed(s.speed ?? 30)}, then rest for ${secs(s.cooldown ?? 5)}.`,
        "Collide with an enemy piece and whoever moved first wins.",
        "Drag a resting piece to premove; it goes the moment it's ready. Tap it to cancel.",
        "Take the king to win. No checks, no checkmate.",
      ];
    case "chess:realtime4":
      return [
        "Four armies, no turns: everyone moves at once on the cross-shaped board.",
        `Pieces travel ${speed(s.speed ?? 30)}, then rest for ${secs(s.cooldown ?? 5)}. First mover wins a collision.`,
        "Lose your king and your whole army turns to grey stone where it stands.",
        "Last king standing wins. Everyone else places by how long they lasted.",
        "No castling. Pawns promote on the middle line.",
      ];
    default:
      return [];
  }
}
