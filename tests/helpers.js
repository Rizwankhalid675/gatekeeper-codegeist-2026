/**
 * Shared fixtures. Deliberately small and explicit: a test that builds its
 * world through five layers of helpers stops telling you what it is testing.
 */

import { DISPOSITION } from '../src/shared/contracts.js';
import { buildBundle, correlate } from '../src/gate/evidence.js';
import { defaultRulePack } from '../src/gate/rulepack.js';

export const NOW = '2026-11-19T18:00:00.000Z';

/** An in-memory stand-in for Forge storage. */
export function memStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async get(key) {
      const v = map.get(key);
      // Forge storage round-trips through JSON, so a test that hands back a
      // live object reference would pass where production fails.
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    },
    async set(key, value) {
      map.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}

/** A rule pack that permits unattended action, for the happy path. */
export function openPack(over = {}) {
  return {
    ...defaultRulePack('NW'),
    version: 7,
    unattendedAllowed: true,
    confidenceFloor: 0.75,
    requireHumanPriorities: ['Highest'],
    ...over,
  };
}

export function incident(over = {}) {
  return {
    issueKey: 'NW-101',
    projectKey: 'NW',
    summary: 'api-gateway returned 503 for 42 requests in 5m',
    description: 'Upstream pool exhausted. Retries did not recover the probe.',
    priority: 'High',
    status: 'Open',
    component: 'api-gateway',
    createdAt: '2026-11-19T17:58:00.000Z',
    ...over,
  };
}

/**
 * A bundle with real correlation run over it, so the digest is the one the
 * production path would produce rather than a hand-written constant.
 */
export function bundleFor(inc = incident(), { recent = [], rulePack = openPack(), comments = [], linkedIssues = [] } = {}) {
  const correlation = correlate({ incident: inc, recent, rulePack, now: NOW });
  return buildBundle({ incident: inc, comments, linkedIssues, correlation });
}

export function proposalFor(bundle, over = {}) {
  return {
    agent: 'remediation',
    issueKey: bundle.issueKey,
    evidenceDigest: bundle.digest,
    rationale: 'Upstream pool exhaustion matches the documented runbook; label it and summarise.',
    confidence: 0.88,
    quotes: [],
    action: { id: 'comment-triage-summary', params: { body: 'Triage: upstream pool exhausted.' } },
    ...over,
  };
}

export function reviewConfirm(over = {}) {
  return {
    verdict: 'confirm',
    quotes: [],
    quotesVerified: true,
    unverifiedQuotes: [],
    rationale: 'Consistent with the evidence.',
    ...over,
  };
}

/** Records every effect call so a test can assert exactly one thing happened. */
export function spyEffects() {
  const calls = [];
  const rec = (name) => async (...args) => {
    calls.push({ name, args });
  };
  return {
    calls,
    comment: rec('comment'),
    transition: rec('transition'),
    assign: rec('assign'),
    link: rec('link'),
    label: rec('label'),
  };
}

export { DISPOSITION };
