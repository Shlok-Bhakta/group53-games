import { FlagPennantIcon, GlobeHemisphereWestIcon } from "@phosphor-icons/react";
import { ListRow } from "@/components/ListRow";
import { Section } from "@/components/parts";

// Golf's page, under the modes: the handmade holes to play on your own (or with whoever's on them), and the
// open world.
export function GolfPractice() {
  return (
    <Section title="Practice">
      <ListRow to="/golf/practice" leading={<FlagPennantIcon size={24} weight="fill" className="text-primary" />} title="Practice holes" detail="Bumper Plains and Cold Start, eighteen holes" />
      <ListRow to="/golf/world" leading={<GlobeHemisphereWestIcon size={24} weight="fill" className="text-primary" />} title="Driftwood Bay" detail="The open world, with whoever's in it" />
    </Section>
  );
}
