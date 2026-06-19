import { describe, expect, it } from 'vitest';
import {
  buildEdgePath,
  isFiniteCanvasPoint,
  resolvePortInfo
} from '../src/services/canvasGraph.js';

describe('canvas graph geometry helpers', () => {
  const componentLibrary = {
    simulation_block: { width: 180, height: 120 },
    signal_source: { width: 120, height: 64 }
  };

  it('resolves side port positions from node geometry and component metadata', () => {
    const node = {
      id: 'sim-1',
      type: 'simulation_block',
      x: 320,
      y: 180
    };
    const ports = {
      inputs: [
        { key: 'input-0', label: '输入 1', side: 'left' },
        { key: 'input-1', label: '输入 2', side: 'left' }
      ],
      outputs: [
        { key: 'output-0', label: '输出 1', side: 'right' }
      ]
    };

    expect(resolvePortInfo(node, 'input', 1, { ports, componentLibrary })).toMatchObject({
      key: 'input-1',
      direction: 'input',
      side: 'left',
      index: 1,
      localX: 0,
      localY: 80,
      x: 320,
      y: 260
    });
    expect(resolvePortInfo(node, 'output', 0, { ports, componentLibrary })).toMatchObject({
      key: 'output-0',
      side: 'right',
      localX: 180,
      localY: 60,
      x: 500,
      y: 240
    });
  });

  it('resolves top ports evenly across the node width', () => {
    const node = {
      id: 'sim-2',
      type: 'simulation_block',
      x: 100,
      y: 50,
      w: 200,
      h: 90
    };
    const ports = {
      inputs: [],
      outputs: [
        { key: 'output-0', label: '输出', side: 'right' },
        { key: 'middle-0', label: '中间量 1', side: 'top' },
        { key: 'middle-1', label: '中间量 2', side: 'top' }
      ]
    };

    expect(resolvePortInfo(node, 'output', 1, { ports, componentLibrary })).toMatchObject({
      key: 'middle-0',
      side: 'top',
      localX: 67,
      localY: 0,
      x: 167,
      y: 50
    });
    expect(resolvePortInfo(node, 'output', 2, { ports, componentLibrary })).toMatchObject({
      key: 'middle-1',
      side: 'top',
      localX: 133,
      y: 50
    });
  });

  it('builds stable bezier paths and rejects invalid points', () => {
    const start = { x: 100, y: 80, side: 'right' };
    const end = { x: 260, y: 140, side: 'left' };

    expect(isFiniteCanvasPoint(start)).toBe(true);
    expect(isFiniteCanvasPoint({ x: Number.NaN, y: 10 })).toBe(false);
    expect(buildEdgePath(start, end)).toBe('M 100 80 C 167.2 80, 192.8 140, 260 140');
    expect(buildEdgePath(null, end)).toBe('M 0 0 C 0 0, 0 0, 0 0');
  });
});
