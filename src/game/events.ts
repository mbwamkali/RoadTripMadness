import { damage, foundCash, priceOf, tankSize, type ActionResult, type GameState } from './state';
import { hashString, makeRng, rangeInt, type Rng } from './rng';

/**
 * Oregon Trail-style road events: something happens, the player picks how
 * to deal with it, and the outcome is applied to the game state.
 */

export type CrewMember = 'gunner' | 'dog' | 'mechanic';

export const CREW: Record<CrewMember, { name: string; icon: string; perk: string }> = {
  gunner: { name: 'Gunner', icon: '🤠', perk: 'Shoots at enemies on their own during fights' },
  dog: { name: 'Road dog', icon: '🐕', perk: 'Sniffs out trouble: searching is safer' },
  mechanic: { name: 'Mechanic', icon: '🧰', perk: 'Patches the car a little after every fight' },
};

export interface EventOutcome extends ActionResult {
  /** Start a fight after the message. */
  fight?: 'zombie' | 'outlaw' | 'catship';
}

export interface EventChoice {
  label: string;
  /** Shown under the label, e.g. the cost. */
  hint?: string;
  /** False when the player can't pick it (can't pay). */
  enabled: boolean;
  apply: () => EventOutcome;
}

export interface RoadEvent {
  id: string;
  icon: string;
  title: string;
  text: string;
  choices: EventChoice[];
}

type Maker = (s: GameState, rng: Rng) => RoadEvent;

const add = (s: GameState, k: keyof GameState['inv'], n: number) => {
  s.inv[k] = Math.max(0, k === 'fuel' ? Math.min(tankSize(s), s.inv[k] + n) : s.inv[k] + n);
};

const MAKERS: Record<string, Maker> = {
  flat: (s, rng) => ({
    id: 'flat',
    icon: '🛞',
    title: 'Flat tire!',
    text: 'Something sharp in the road. The car lurches and the back left tire goes flat.',
    choices: [
      {
        label: 'Patch it',
        hint: '3 scrap',
        enabled: s.inv.scrap >= 3,
        apply: () => {
          add(s, 'scrap', -3);
          return { ok: true, message: 'You patch the tire and get rolling again.' };
        },
      },
      {
        label: 'Drive on the rim',
        hint: 'Damages the car',
        enabled: true,
        apply: () => {
          const d = rangeInt(rng, 8, 14);
          damage(s, d);
          return { ok: false, message: `Sparks fly. The car takes ${d} damage before the next tire shop.` };
        },
      },
    ],
  }),

  hitchhiker: (s, rng) => {
    const has = s.crew.includes('gunner');
    return {
      id: 'hitchhiker',
      icon: '👍',
      title: 'Hitchhiker',
      text: has
        ? 'A dusty stranger with a rifle thumbs for a ride. Your gunner eyes them suspiciously.'
        : 'A dusty stranger with a rifle thumbs for a ride. "I can shoot," they say.',
      choices: [
        {
          label: 'Pick them up',
          enabled: true,
          apply: () => {
            if (rng() < 0.3) return { ok: false, message: 'It was a setup! Their buddies roar out from behind a billboard.', fight: 'outlaw' };
            if (has) {
              add(s, 'bullets', 25);
              return { ok: true, message: 'They ride a while, then hop out at a crossroads, leaving you a box of 25 bullets.' };
            }
            s.crew.push('gunner');
            return { ok: true, message: 'They climb in and take the roof gun. You have a gunner!' };
          },
        },
        { label: 'Drive past', enabled: true, apply: () => ({ ok: true, message: 'You leave them in the dust.' }) },
      ],
    };
  },

  bridge: (s, rng) => ({
    id: 'bridge',
    icon: '🌉',
    title: 'Bridge out',
    text: 'The bridge ahead has collapsed into the creek. A detour sign points off into the hills.',
    choices: [
      {
        label: 'Ford the creek',
        hint: 'Risky',
        enabled: true,
        apply: () => {
          if (rng() < 0.55) return { ok: true, message: 'The water comes up to the doors, but you make it across.' };
          const d = rangeInt(rng, 10, 18);
          damage(s, d);
          add(s, 'fuel', -6);
          return { ok: false, message: `The engine floods. You lose 6 fuel and the car takes ${d} damage.` };
        },
      },
      {
        label: 'Take the detour',
        hint: '10 fuel',
        enabled: s.inv.fuel > 12,
        apply: () => {
          add(s, 'fuel', -10);
          return { ok: true, message: 'Two hours of gravel roads later, you are back on the highway.' };
        },
      },
    ],
  }),

  trader: (s) => ({
    id: 'trader',
    icon: '🛒',
    title: 'Roadside trader',
    text: 'An old truck loaded with junk is parked by the road. "Got something for everyone," says the trader.',
    choices: [
      {
        label: 'Scrap for bullets',
        hint: '10 scrap → 35 bullets',
        enabled: s.inv.scrap >= 10,
        apply: () => {
          add(s, 'scrap', -10);
          add(s, 'bullets', 35);
          return { ok: true, message: 'Deal. 35 bullets.' };
        },
      },
      {
        label: 'Buy shells and catnip',
        hint: `$${priceOf(s, 30)} → 4 shells, 1 catnip`,
        enabled: s.inv.cash >= priceOf(s, 30),
        apply: () => {
          add(s, 'cash', -priceOf(s, 30));
          add(s, 'shells', 4);
          add(s, 'catnip', 1);
          return { ok: true, message: 'You load up 4 shells and a catnip bomb.' };
        },
      },
      {
        label: 'Buy a gas can',
        hint: `$${priceOf(s, 25)} → 20 fuel`,
        enabled: s.inv.cash >= priceOf(s, 25),
        apply: () => {
          add(s, 'cash', -priceOf(s, 25));
          add(s, 'fuel', 20);
          return { ok: true, message: 'You top up with 20 fuel.' };
        },
      },
      { label: 'No thanks', enabled: true, apply: () => ({ ok: true, message: '"Your loss," the trader shrugs.' }) },
    ],
  }),

  wreck: (s, rng) => ({
    id: 'wreck',
    icon: '🚙',
    title: 'Abandoned car',
    text: 'A station wagon sits on the shoulder, doors open, keys still in it.',
    choices: [
      {
        label: 'Search it',
        enabled: true,
        apply: () => {
          if (rng() < (s.crew.includes('dog') ? 0.2 : 0.35)) return { ok: false, message: 'Something is still in the back seat. It is hungry.', fight: 'zombie' };
          const fuel = rangeInt(rng, 5, 15);
          const scrap = rangeInt(rng, 3, 8);
          const cash = foundCash(s, rangeInt(rng, 0, 20));
          add(s, 'fuel', fuel);
          add(s, 'scrap', scrap);
          add(s, 'cash', cash);
          return { ok: true, message: `You siphon ${fuel} fuel and strip ${scrap} scrap${cash ? `, plus $${cash} from the glovebox` : ''}.` };
        },
      },
      { label: 'Leave it', enabled: true, apply: () => ({ ok: true, message: 'Probably for the best.' }) },
    ],
  }),

  beam: (s, rng) => ({
    id: 'beam',
    icon: '🛸',
    title: 'Tractor beam!',
    text: 'A purple light locks onto the car. Your hair stands up. Somewhere above, a cat is purring.',
    choices: [
      {
        label: 'Throw catnip',
        hint: '1 catnip bomb',
        enabled: s.inv.catnip >= 1,
        apply: () => {
          add(s, 'catnip', -1);
          const scrap = rangeInt(rng, 6, 14);
          add(s, 'scrap', scrap);
          return { ok: true, message: `The saucer wobbles off, very happy. It drops ${scrap} scrap of alien metal.` };
        },
      },
      {
        label: 'Floor it',
        hint: '8 fuel',
        enabled: s.inv.fuel > 10,
        apply: () => {
          add(s, 'fuel', -8);
          if (rng() < 0.7) return { ok: true, message: 'You burn rubber out of the beam.' };
          return { ok: false, message: 'Not fast enough. Here they come!', fight: 'catship' };
        },
      },
      {
        label: 'Shoot at it',
        enabled: true,
        apply: () => ({ ok: true, message: 'You open fire. It fires back.', fight: 'catship' }),
      },
    ],
  }),

  roadblock: (s, rng) => ({
    id: 'roadblock',
    icon: '🚧',
    title: 'Outlaw roadblock',
    text: 'Burning barrels and a line of motorcycles block the road. "Pay the toll!" yells their leader.',
    choices: [
      {
        label: 'Pay the toll',
        hint: `$${priceOf(s, 30)}`,
        enabled: s.inv.cash >= priceOf(s, 30),
        apply: () => {
          add(s, 'cash', -priceOf(s, 30));
          return { ok: true, message: 'They wave you through, laughing.' };
        },
      },
      {
        label: 'Ram through',
        hint: s.upgrades.ram > 0 ? 'Your ram plate helps' : 'Damages the car',
        enabled: true,
        apply: () => {
          const d = Math.max(0, rangeInt(rng, 10, 16) - s.upgrades.ram * 5);
          damage(s, d);
          return { ok: true, message: d ? `Barrels everywhere! You smash through, taking ${d} damage.` : 'Your ram plate scatters the barricade like bowling pins.' };
        },
      },
      { label: 'Fight', enabled: true, apply: () => ({ ok: true, message: 'You reach for the guns.', fight: 'outlaw' }) },
    ],
  }),

  dog: (s) => ({
    id: 'dog',
    icon: '🐕',
    title: 'Stray dog',
    text: 'A scruffy dog trots alongside the car, tongue out, clearly expecting to be let in.',
    choices: s.crew.includes('dog')
      ? [{ label: 'Wave goodbye', enabled: true, apply: () => ({ ok: true, message: 'Your own dog barks at it jealously.' }) }]
      : [
          {
            label: 'Let them in',
            enabled: true,
            apply: () => {
              s.crew.push('dog');
              return { ok: true, message: 'The dog curls up on the passenger seat. Searching places will be safer with a nose like that.' };
            },
          },
          { label: 'Keep driving', enabled: true, apply: () => ({ ok: true, message: 'The dog watches you go.' }) },
        ],
  }),

  mechanic: (s) => ({
    id: 'mechanic',
    icon: '🧰',
    title: 'Stranded mechanic',
    text: 'A woman in grease-stained overalls stands next to a smoking tow truck. "Need a lift? I can keep your car running."',
    choices: s.crew.includes('mechanic')
      ? [
          {
            label: 'Give her some fuel',
            hint: '8 fuel',
            enabled: s.inv.fuel > 10,
            apply: () => {
              add(s, 'fuel', -8);
              add(s, 'scrap', 10);
              return { ok: true, message: 'She thanks you with a bag of 10 spare parts.' };
            },
          },
          { label: 'Keep driving', enabled: true, apply: () => ({ ok: true, message: 'You already have a mechanic. She understands.' }) },
        ]
      : [
          {
            label: 'Give her a ride',
            enabled: true,
            apply: () => {
              s.crew.push('mechanic');
              return { ok: true, message: 'She hops in. She will patch the car after every fight.' };
            },
          },
          { label: 'Keep driving', enabled: true, apply: () => ({ ok: true, message: 'You leave her to it.' }) },
        ],
  }),
};

export const EVENT_IDS = Object.keys(MAKERS);

/** Picks and builds the next road event. Rare events (crew joining) get rarer once you have that crew. */
export function rollEvent(s: GameState): RoadEvent {
  const rng = makeRng(s.seed ^ hashString(`event${s.eventsSeen}`));
  const weights: [string, number][] = [
    ['flat', 2],
    ['hitchhiker', s.crew.includes('gunner') ? 0.5 : 1.5],
    ['bridge', 1.5],
    ['trader', 2],
    ['wreck', 2],
    ['beam', 1.2],
    ['roadblock', 1.5],
    ['dog', s.crew.includes('dog') ? 0.3 : 1],
    ['mechanic', s.crew.includes('mechanic') ? 0.3 : 1],
  ];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  let id = weights[0][0];
  for (const [k, w] of weights) {
    r -= w;
    if (r <= 0) {
      id = k;
      break;
    }
  }
  return MAKERS[id](s, rng);
}

export function makeEvent(id: string, s: GameState): RoadEvent {
  return MAKERS[id](s, makeRng(s.seed ^ hashString(`event${s.eventsSeen}${id}`)));
}


