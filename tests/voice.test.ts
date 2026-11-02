import { describe, expect, it } from 'vitest';
import { autoVoice, orderVoices } from '../src/audio/narrator';

const v = (name: string, lang: string, localService = true) => ({ name, lang, localService, voiceURI: `${name}-${lang}` });

describe('narrator voices', () => {
  const all = [v('Amélie', 'fr-CA'), v('Google UK', 'en-GB', false), v('Samantha', 'en-US'), v('Daniel', 'en-GB'), v('Anna', 'de-DE')];

  it('lists English on-device voices first, then online English, then other languages', () => {
    expect(orderVoices(all).map((x) => x.name)).toEqual(['Daniel', 'Samantha', 'Google UK', 'Anna', 'Amélie']);
  });

  it('picks a US English on-device voice automatically', () => {
    expect(autoVoice(all)?.name).toBe('Samantha');
    expect(autoVoice([v('Anna', 'de-DE')])?.name).toBe('Anna');
    expect(autoVoice([])).toBeNull();
  });
});
