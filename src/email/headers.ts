export interface Deliverability {
  spf: 'pass' | 'fail' | 'neutral' | 'unknown';
  dkim: 'pass' | 'fail' | 'unknown';
  dmarc: 'pass' | 'fail' | 'unknown';
}

// Regex patterns for deliverability header extraction
const SPF_RE = /^Received-SPF:\s+(pass|fail|neutral|softfail|none|permerror|temperror)\b/mi;
const DKIM_RE = /\bdkim=(pass|fail|none|neutral|permerror|temperror)\b/i;
const DMARC_RE = /\bdmarc=(pass|fail|none|neutral|permerror|temperror)\b/i;

function normalize(value: string): Deliverability[keyof Deliverability] {
  if (value.toLowerCase() === 'pass') return 'pass';
  if (value.toLowerCase() === 'fail' || value.toLowerCase() === 'permerror' || value.toLowerCase() === 'temperror') return 'fail';
  if (value.toLowerCase() === 'neutral' || value.toLowerCase() === 'softfail') return 'neutral';
  return 'unknown';
}

/**
 * Extract SPF, DKIM, and DMARC status from raw email headers.
 * Scans Received-SPF and Authentication-Results headers.
 */
export function extractDeliverability(rawHeaders: string): Deliverability {
  let spf: Deliverability['spf'] = 'unknown';
  let dkim: Deliverability['dkim'] = 'unknown';
  let dmarc: Deliverability['dmarc'] = 'unknown';

  // SPF — look for Received-SPF header
  const spfMatch = rawHeaders.match(SPF_RE);
  if (spfMatch) spf = normalize(spfMatch[1]) as Deliverability['spf'];

  // DKIM + DMARC — look for Authentication-Results (most reliable)
  const authLines = rawHeaders.match(/^Authentication-Results:.*$/gim);
  if (authLines) {
    for (const line of authLines) {
      const dkimMatch = line.match(DKIM_RE);
      if (dkimMatch && dkim === 'unknown') dkim = normalize(dkimMatch[1]) as Deliverability['dkim'];

      const dmarcMatch = line.match(DMARC_RE);
      if (dmarcMatch && dmarc === 'unknown') dmarc = normalize(dmarcMatch[1]) as Deliverability['dmarc'];
    }
  }

  // Also try ARC-Authentication-Results as fallback
  const arcLines = rawHeaders.match(/^ARC-Authentication-Results:.*$/gim);
  if (arcLines) {
    for (const line of arcLines) {
      if (dkim === 'unknown') {
        const d = line.match(DKIM_RE);
        if (d) dkim = normalize(d[1]) as Deliverability['dkim'];
      }
      if (spf === 'unknown') {
        const s = line.match(SPF_RE);
        if (s) spf = normalize(s[1]) as Deliverability['spf'];
      }
      if (dmarc === 'unknown') {
        const dm = line.match(DMARC_RE);
        if (dm) dmarc = normalize(dm[1]) as Deliverability['dmarc'];
      }
    }
  }

  return { spf, dkim, dmarc };
}
