import { describe, expect, it } from 'vitest';
import {
  buildEdgePath,
  isFiniteCanvasPoint,
  resolvePortInfo,
  resolvePortInfos
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

  it('allows inputs on the right and outputs on the left without changing their roles', () => {
    const node = {
      id: 'sim-reversed-sides',
      type: 'simulation_block',
      x: 100,
      y: 50,
      w: 200,
      h: 90
    };
    const ports = {
      inputs: [{ key: 'input-0', label: '右侧输入', side: 'right' }],
      outputs: [{ key: 'output-0', label: '左侧输出', side: 'left' }]
    };

    expect(resolvePortInfo(node, 'input', 0, { ports, componentLibrary })).toMatchObject({
      direction: 'input',
      side: 'right',
      localX: 200,
      x: 300
    });
    expect(resolvePortInfo(node, 'output', 0, { ports, componentLibrary })).toMatchObject({
      direction: 'output',
      side: 'left',
      localX: 0,
      x: 100
    });
  });

  it('keeps an explicitly configured third slot even when earlier side slots are empty', () => {
    const node = {
      id: 'sim-third-left-slot',
      type: 'simulation_block',
      x: 100,
      y: 50,
      w: 200,
      h: 90
    };
    const ports = {
      inputs: [],
      outputs: [{ key: 'output-a', label: '端口 A', side: 'left', sidePosition: 3 }]
    };

    expect(resolvePortInfo(node, 'output', 0, { ports, componentLibrary })).toMatchObject({
      side: 'left',
      sidePosition: 3,
      localX: 0,
      localY: 68,
      x: 100,
      y: 118
    });
  });

  it('uses one shared side-slot sequence when inputs and outputs are placed on the same side', () => {
    const node = {
      id: 'sim-shared-left-slots',
      type: 'simulation_block',
      x: 100,
      y: 50,
      w: 200,
      h: 90
    };
    const ports = {
      inputs: [{ key: 'input-a', label: '输入 A', side: 'left' }],
      outputs: [{ key: 'output-a', label: '输出 A', side: 'left', sidePosition: 3 }]
    };

    expect(resolvePortInfo(node, 'input', 0, { ports, componentLibrary })).toMatchObject({
      localY: 23,
      y: 73
    });
    expect(resolvePortInfo(node, 'output', 0, { ports, componentLibrary })).toMatchObject({
      localY: 68,
      y: 118
    });
  });

  it('places a 32-port component in one pass with the same side slots as individual lookups', () => {
    const node = { type: 'simulation_block', x: 80, y: 40, w: 240, h: 1100 };
    const ports = {
      inputs: Array.from({ length: 32 }, (_, index) => ({
        key: `input-${index}`,
        side: index % 8 === 0 ? 'top' : 'left',
        ...(index === 3 ? { sidePosition: 12 } : {})
      })),
      outputs: Array.from({ length: 32 }, (_, index) => ({
        key: `output-${index}`,
        side: index % 7 === 0 ? 'left' : 'right',
        ...(index === 4 ? { sidePosition: 9 } : {})
      }))
    };
    const options = { ports, componentLibrary };
    const layout = resolvePortInfos(node, options);
    for (const [direction, list] of [['input', layout.inputs], ['output', layout.outputs]]) {
      list.forEach((info, index) => {
        expect(info).toEqual(resolvePortInfo(node, direction, index, options));
      });
    }
  });

  it('resolves bottom power ports across the node width and routes away from the node', () => {
    const node = {
      id: 'sim-3',
      type: 'simulation_block',
      x: 100,
      y: 50,
      w: 200,
      h: 90
    };
    const ports = {
      inputs: [],
      outputs: [{ key: 'power-output-0', label: '电源地', side: 'bottom' }]
    };

    const powerPort = resolvePortInfo(node, 'output', 0, { ports, componentLibrary });
    expect(powerPort).toMatchObject({
      side: 'bottom',
      localX: 100,
      localY: 90,
      x: 200,
      y: 140
    });
    expect(buildEdgePath(powerPort, { x: 260, y: 220, side: 'top' }))
      .toBe('M 200 140 C 200 188, 260 172, 260 220');
  });

  it('builds stable bezier paths and rejects invalid points', () => {
    const start = { x: 100, y: 80, side: 'right' };
    const end = { x: 260, y: 140, side: 'left' };

    expect(isFiniteCanvasPoint(start)).toBe(true);
    expect(isFiniteCanvasPoint({ x: Number.NaN, y: 10 })).toBe(false);
    expect(buildEdgePath(start, end)).toBe('M 100 80 C 167.2 80, 192.8 140, 260 140');
    expect(buildEdgePath(null, end)).toBe('M 0 0 C 0 0, 0 0, 0 0');
  });

  it('routes a left-side output out of the node’s left edge', () => {
    const source = { x: 480, y: 180, side: 'left' };
    const target = { x: 260, y: 220, side: 'left' };

    const path = buildEdgePath(source, target);

    expect(path).toMatch(/^M 480 180 C (\d+(?:\.\d+)?) /);
    const [, firstControlX] = path.match(/^M 480 180 C (\d+(?:\.\d+)?) /);
    expect(Number(firstControlX)).toBeLessThan(source.x);
  });
});
