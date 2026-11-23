import test from 'node:test';
import assert from 'node:assert/strict';
import { editionMismatch } from '../news-collect.js';

test('Monaco edition rejects an unrelated PSG/Nice injury when Monaco appears only in a deep transfer table', () => {
  const strict = (text, lead) => editionMismatch('MC', text, { strict: true, lead });
  const headline = "Désiré Doué suffers an ACL injury after PSG's defeat to Nice";
  const lead = "PSG confirmed the diagnosis after the winger was carried off against Nice. The club will assess his recovery.";
  const relatedBody = lead + " Other transfer activity: Maghnes Akliouche Monaco €50m; Ferran Torres Barcelona €48.5m.";
  assert.ok(strict(relatedBody, lead));
  assert.ok(strict(headline + ' ' + lead, headline + ' ' + lead));
});

test('Monaco-specific reporting remains eligible for the Monaco edition', () => {
  const strict = (text, lead) => editionMismatch('MC', text, { strict: true, lead });
  for (const [headline, lead] of [
    ["Monaco 'heading in right direction' despite Dier frustration", "England centre-half Eric Dier believes Monaco are headed in the right direction."],
    ["L'AS Monaco reçoit l'AJ Auxerre au stade Louis II", "L'AS Monaco reçoit Auxerre au stade Louis II pour la 11e journée de Ligue 1."],
    ["Camille Gottlieb annonce une heureuse nouvelle", "Camille Gottlieb présente un nouveau projet à Monaco."],
    ["Le Gouvernement Princier annonce un nouveau dispositif", "Le Gouvernement Princier de Monaco a présenté le dispositif à Monte-Carlo."]
  ]) assert.equal(strict(headline + ' ' + lead, headline + ' ' + lead), '');
});

test('Luxembourg collection distinguishes the Belgian province from the Grand Duchy', () => {
  assert.ok(editionMismatch('LU', 'La province de Luxembourg en Belgique annonce quatre disqualifications à Arlon.'));
  assert.equal(editionMismatch('LU', 'Le Grand-Duché de Luxembourg présente son budget national.'), '');
});

test('a Swiss Conseil National report does not qualify for Monaco', () => {
  const lead = 'Le Conseil National suisse débat du budget à Berne.';
  assert.ok(editionMismatch('MC', lead, { strict: true, lead }));
});
