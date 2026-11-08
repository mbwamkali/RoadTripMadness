import { describe, expect, it } from 'vitest';
import { sceneKindFor } from '../src/scenes/eventScene';

describe('event scenes', () => {
  it('has a scene for every road event and for running out of gas', () => {
    const ids = ['flat', 'hitchhiker', 'bridge', 'trader', 'wreck', 'beam', 'roadblock', 'dog', 'mechanic', 'bike'];
    expect(ids.map(sceneKindFor)).toEqual(['flat', 'hitch', 'bridge', 'trade', 'loot', 'beam', 'roadblock', 'dog', 'help', 'fuel']);
  });
});
