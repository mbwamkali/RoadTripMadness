import { BOSS_INFO, ENEMY_STATS, type BossKind } from '../game/combat';
import { narrator } from '../audio/narrator';
import { kidMode } from '../game/kidMode';
import { h, ui } from './dom';

/**
 * The "How to play" screen on the title menu. Every tip is a big picture and
 * one or two short sentences, so a young player can follow the pictures and
 * hear it read: tap any tip, or a section's speaker, to have it read aloud
 * (it reads even with narration switched off). Kid mode reads the welcome
 * line on its own.
 */

export interface Tip {
  icon: string;
  title: string;
  text: string;
}

export interface Section {
  id: string;
  icon: string;
  title: string;
  tips: Tip[];
}

/** What each boss does, in one line (the names and icons come from the game). */
const BOSS_LINES: Record<BossKind, string> = {
  brute: 'A giant zombie. Get out of the red lane before he stomps.',
  warrig: 'A spiky truck with gunners. A red lane means a rocket is coming.',
  hermit: 'Hops along the roadside throwing junk at you.',
  pizza: 'Throws pizzas. Beat him and eat them to fix your car.',
  sweeper: 'Angry cats drive it and spray trash bags across two lanes.',
  karen: 'Throws her cats at you. Beat her to learn her secret.',
  drones: 'A swarm of paper-plane drones. Shoot the big one to send them home.',
  mothership: 'The Cat Queen. She waits at the end of every trip. Catnip hurts her a lot.',
};

const HALFWAY_ORDER: BossKind[] = ['brute', 'warrig', 'hermit', 'pizza', 'sweeper', 'karen', 'drones', 'mothership'];

export const SECTIONS: Section[] = [
  {
    id: 'goal',
    icon: '🏁',
    title: 'The goal',
    tips: [
      { icon: '🗺️', title: 'Drive to the end', text: 'Pick a real trip and drive all the way to the end of the road.' },
      { icon: '⛽', title: 'Keep gas in the tank', text: 'If the gas runs out, the trip is over. Stop at green dots for gas.' },
      { icon: '🔧', title: "Don't wreck the car", text: 'Bad guys and crashes hurt the car. Fix it at a garage.' },
      { icon: '👑', title: 'Beat the bosses', text: 'A boss waits halfway, and the Cat Queen waits at the end.' },
    ],
  },
  {
    id: 'driving',
    icon: '🚗',
    title: 'Driving',
    tips: [
      { icon: '↔️', title: 'Change lanes', text: 'Swipe left or right, or tap the arrow buttons.' },
      { icon: '↕️', title: 'Go faster or slower', text: 'Swipe up or down, or tap plus and minus. Going fast burns more gas.' },
      { icon: '🚙', title: 'Watch the traffic', text: 'Slow cars ahead make you brake. Stay on your side of the road.' },
      { icon: '🔫', title: 'Shoot what is in the way', text: 'Double-tap a car or a thing on the road to shoot it. In kid mode, tap the big gun button.' },
      { icon: '🚧', title: 'Off the road', text: 'Steer past the last lane to drive off the road. Posts fall over. Buildings and trees stop you!' },
      { icon: '🐄', title: 'Animals crossing', text: 'Cows and giant armadillos walk across the road. Slow down, steer around, or tap Honk and they run off.' },
      { icon: '🤖', title: 'Autopilot', text: 'Tap the robot to drive faster by itself. It stays on the road, slows for animals, but still hits things in the road.' },
      { icon: '😠', title: 'Road rage', text: 'Shoot normal drivers and they get angry and shoot back.' },
    ],
  },
  {
    id: 'stops',
    icon: '🛣️',
    title: 'Exits and towns',
    tips: [
      { icon: '🪧', title: 'A sign shows up', text: 'When a town is coming, a sign pops up at the bottom.' },
      { icon: '▶️', title: 'Take the exit', text: 'Tap Take the exit once. The blinker goes on and the car turns in by itself.' },
      { icon: '⏩', title: 'Or keep driving', text: 'Tap Keep driving to skip that town.' },
      { icon: '🏘️', title: 'In town', text: 'Tap a building. Get gas, fix the car, or search: tap the boxes! Too much noise wakes zombies.' },
    ],
  },
  {
    id: 'car',
    icon: '🔧',
    title: 'Your car',
    tips: [
      { icon: '⛽', title: 'Gas', text: 'A full tank lasts about a third of the trip.' },
      { icon: '🛠️', title: 'Garage', text: 'Fix the car and buy upgrades with scrap and cash.' },
      { icon: '🛡️', title: 'Upgrades', text: 'Armor, a bigger tank, a better engine, a roof gun and a ram plate.' },
      { icon: '⭐', title: 'Keep them', text: 'Finish a trip and your upgrades come with you to the next one.' },
      { icon: '🚲', title: 'Out of gas?', text: 'Once a trip, you can ride a bike to the next gas station.' },
    ],
  },
  {
    id: 'fights',
    icon: '⚔️',
    title: 'Fights',
    tips: [
      { icon: '👆', title: 'Shoot', text: 'Tap or hold on a bad guy to shoot it.' },
      { icon: '🔫', title: 'Pick a weapon', text: 'Machine gun for fast shots, shotgun for a group, catnip bomb for alien cats.' },
      { icon: '🟡', title: 'Yellow blink', text: 'A bad guy blinks before it attacks. Move out of the way!' },
      { icon: '🟥', title: 'Red lane', text: 'A red lane means a big hit is coming there. Steer out of it.' },
      { icon: '↔️', title: 'Steer', text: 'Swipe sideways or use the arrows to dodge.' },
      { icon: '📯', title: 'Horn', text: 'Free. Freezes nearby bad guys for a few seconds. Then it has to recharge.' },
      { icon: '🔥', title: 'Boost', text: 'Costs 4 gas. Plough through zombies, throw off grabbers, and get away faster.' },
      { icon: '🏃', title: 'Get away', text: 'Survive until the meter fills to escape. Bosses have to be beaten.' },
    ],
  },
  {
    id: 'enemies',
    icon: '🧟',
    title: 'Bad guys',
    tips: [
      { icon: '🧟', title: 'Zombies', text: 'Some throw junk, and some grab the car. Steer hard to shake them off.' },
      { icon: '🧟‍♂️', title: 'Zombie horde', text: 'Lots of zombies at once! Each one falls with one hit.' },
      { icon: '🏍️', title: 'Outlaw bikers', text: 'They ride next to you and shoot. Boost to leave them behind.' },
      { icon: '🛸', title: 'Alien cats', text: 'Flying saucers with laser beams. Catnip bombs hurt them most.' },
    ],
  },
  {
    id: 'bosses',
    icon: '👑',
    title: 'Bosses',
    tips: HALFWAY_ORDER.map((b) => ({ icon: BOSS_INFO[b].icon, title: ENEMY_STATS[b].name, text: BOSS_LINES[b] })),
  },
  {
    id: 'settings',
    icon: '⚙️',
    title: 'Kid mode and settings',
    tips: [
      { icon: '🧒', title: 'Kid mode', text: 'Big buttons, pictures, the easiest trip, and everything is read out loud.' },
      { icon: '🔊', title: 'Narration', text: 'The phone reads the game out loud. Turn it on in the pause menu.' },
      { icon: '⏸️', title: 'Pause', text: 'Tap the menu button to pause, change graphics, or turn sounds and scenes on and off.' },
      { icon: '⚠️', title: 'Getting harder', text: 'Every trip you finish makes the next one a little harder. Start over any time on the trip screen.' },
    ],
  },
];

/** The words read for a section: its title, then each tip. */
export const sectionSpeech = (s: Section) => `${s.title}. ${s.tips.map((t) => `${t.title}. ${t.text}`).join(' ')}`;

export function showHowToPlay(back: () => void): void {
  const sections = SECTIONS.map((s) => {
    const speak = h('button', { class: 'btn small ghost speak', 'aria-label': `Read ${s.title} out loud` }, '🔊');
    speak.addEventListener('click', () => narrator.say(sectionSpeech(s), true));
    return h(
      'section',
      { class: 'howto-section', id: `howto-${s.id}` },
      h('div', { class: 'howto-head' }, h('h3', {}, `${s.icon} ${s.title}`), narrator.available && speak),
      h(
        'div',
        { class: 'howto-tips' },
        ...s.tips.map((t) => {
          const tip = h('button', { class: 'howto-tip' }, h('span', { class: 'howto-icon', 'aria-hidden': 'true' }, t.icon), h('span', {}, h('b', {}, t.title), h('span', { class: 'muted' }, t.text)));
          tip.addEventListener('click', () => narrator.say(`${t.title}. ${t.text}`, true));
          return tip;
        }),
      ),
    );
  });
  const jump = h(
    'nav',
    { class: 'howto-jump' },
    ...SECTIONS.map((s) => {
      const b = h('button', { class: 'btn small', title: s.title }, s.icon);
      b.addEventListener('click', () => document.getElementById(`howto-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return b;
    }),
  );
  ui().replaceChildren(
    h(
      'div',
      { class: 'screen howto', 'data-quiet': true },
      h('h2', {}, '❓ How to play'),
      h('p', { class: 'muted' }, narrator.available ? 'Tap any picture to hear it.' : 'Drive, fight and get to the end of the road.'),
      jump,
      ...sections,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => (narrator.stop(), back()) }, '← Back')),
    ),
  );
  if (kidMode.on) narrator.say('How to play. Tap any picture to hear it.');
}
