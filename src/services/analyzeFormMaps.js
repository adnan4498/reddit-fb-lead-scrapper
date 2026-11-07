'use strict';

const fs = require('fs');
const path = require('path');

const PARSED_DIR = path.resolve(__dirname, '..', '..', 'form_maps', 'parsed');
const OUTPUT_FILE = path.resolve(__dirname, '..', '..', 'form_maps', 'field_summary.txt');

function normalizeLabel(field) {
  const raw = (field.label || field.name || '').toLowerCase().trim();
  return raw.replace(/\s+/g, ' ').replace(/[*:?]/g, '').trim();
}

function run() {
  if (!fs.existsSync(PARSED_DIR)) {
    console.error('Directory not found:', PARSED_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(PARSED_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} JSON files`);

  const fieldMap = new Map();

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(PARSED_DIR, file), 'utf8'));
    const fields = raw.fields || [];
    for (const f of fields) {
      const key = normalizeLabel(f) || f.name || f.id || 'unknown';
      if (!fieldMap.has(key)) {
        fieldMap.set(key, { count: 0, types: new Set(), options: [] });
      }
      const entry = fieldMap.get(key);
      entry.count++;
      entry.types.add(f.type);
      if (f.options && f.options.length > 0) {
        for (const o of f.options) {
          if (!entry.options.includes(o)) entry.options.push(o);
        }
      }
    }
  }

  const sorted = Array.from(fieldMap.entries())
    .sort((a, b) => b[1].count - a[1].count);

  const lines = [
    'FIELD SUMMARY — Form Maps Analysis',
    `Source: ${files.length} forms across form_maps/parsed/`,
    `Generated: ${new Date().toISOString()}`,
    '',
    `${'#'.padEnd(5)} ${'FIELD LABEL'.padEnd(50)} ${'COUNT'.padEnd(7)} TYPES`,
    '-'.repeat(100),
  ];

  for (const [label, entry] of sorted) {
    const typesStr = Array.from(entry.types).join(', ');
    lines.push(`${String(entry.count).padEnd(5)} ${label.substring(0, 49).padEnd(50)} ${String(entry.count).padEnd(7)} ${typesStr}`);
    if (entry.options.length > 0) {
      lines.push(`      Options: ${entry.options.join(' | ')}`);
    }
  }

  lines.push('');
  lines.push('─'.repeat(100));
  lines.push('DROPDOWNS & OPTIONS BREAKDOWN');
  lines.push('─'.repeat(100));
  for (const [label, entry] of sorted) {
    if (entry.options.length > 0) {
      lines.push(`\n${label} (${entry.count} forms)`);
      for (const o of entry.options) {
        lines.push(`  - ${o}`);
      }
    }
  }

  const output = lines.join('\n');
  fs.writeFileSync(OUTPUT_FILE, output);
  console.log(`Saved to ${OUTPUT_FILE}`);
  console.log(`${fieldMap.size} unique fields across ${files.length} forms.`);
}

run();
