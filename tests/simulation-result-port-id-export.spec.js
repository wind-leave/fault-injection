import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.resolve(__dirname, '../src/services/legacy-runtime.txt');

describe('simulation result connection export', () => {
  it('exports stable port IDs instead of display labels', () => {
    const runtime = fs.readFileSync(runtimePath, 'utf8');
    const start = runtime.indexOf('function getRenderDataPortId(');
    const end = runtime.indexOf('\nfunction buildSimulationRenderDataSnapshot', start);
    const implementation = runtime.slice(start, end);

    expect(implementation).toContain('port?.meta?.portId');
    expect(implementation).toContain('port?.meta?.id');
    expect(implementation).not.toContain('port?.label');
    expect(runtime).toContain("sourcePort:getRenderDataPortId(source,'source',edge.sourcePortIndex||0)");
    expect(runtime).toContain("targetPort:getRenderDataPortId(target,'target',edge.targetPortIndex||0)");
  });
});
