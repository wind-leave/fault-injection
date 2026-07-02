import { describe, expect, it } from 'vitest';
import {
  SIGNAL_DOMAINS,
  createSignalSourceProps,
  getSignalSourceScalarFallback,
  normalizeSignalSourceProps,
  summarizeSignalSource
} from '../src/services/signalSourceDomainService.js';

describe('signalSourceDomainService', () => {
  it('defines the supported signal domains in display order', () => {
    expect(SIGNAL_DOMAINS.map((item) => item.value)).toEqual(['digital', 'command', 'analog', 'rf']);
    expect(SIGNAL_DOMAINS.map((item) => item.label)).toEqual(['数字信号', '指令信号', '模拟信号', '射频信号']);
  });

  it('creates defaults for all signal source domains without changing node type', () => {
    expect(createSignalSourceProps('digital')).toMatchObject({
      name: '数字信号源',
      signalDomain: 'digital',
      digitalMode: 'boolean',
      initialState: '0'
    });
    expect(createSignalSourceProps('command')).toMatchObject({
      name: '指令信号源',
      signalDomain: 'command',
      commandType: 'control',
      protocol: 'CAN',
      payloadKind: 'float32'
    });
    expect(createSignalSourceProps('analog')).toMatchObject({
      name: '模拟信号源',
      signalDomain: 'analog',
      waveType: '正弦',
      amplitude: '1.0',
      frequency: '1.0',
      outputFormat: '标量'
    });
    expect(createSignalSourceProps('rf')).toMatchObject({
      name: '射频信号源',
      signalDomain: 'rf',
      rfKind: 'communication',
      centerFrequency: '',
      bandwidth: '',
      powerUnit: 'dBm'
    });
  });

  it('normalizes old signal source props as analog while preserving old fields', () => {
    expect(normalizeSignalSourceProps({
      name: '旧信号源',
      waveType: '常值',
      amplitude: '2.5',
      frequency: '0',
      outputFormat: '标量'
    })).toMatchObject({
      name: '旧信号源',
      signalDomain: 'analog',
      waveType: '常值',
      amplitude: '2.5',
      frequency: '0',
      outputFormat: '标量'
    });
  });

  it('keeps previous-domain fields when normalizing after a domain switch', () => {
    expect(normalizeSignalSourceProps({
      name: '可切换源',
      signalDomain: 'rf',
      waveType: '阶跃',
      amplitude: '3',
      centerFrequency: '2.4GHz'
    })).toMatchObject({
      name: '可切换源',
      signalDomain: 'rf',
      waveType: '阶跃',
      amplitude: '3',
      centerFrequency: '2.4GHz',
      powerUnit: 'dBm'
    });
  });

  it('summarizes each signal domain for canvas display', () => {
    expect(summarizeSignalSource({ props: createSignalSourceProps('digital', { digitalMode: 'pulse', period: '20ms' }) }))
      .toBe('数字 · pulse · 周期 20ms');
    expect(summarizeSignalSource({ props: createSignalSourceProps('command', { protocol: 'CAN', messageId: '0x120' }) }))
      .toBe('指令 · CAN · 0x120 · float32');
    expect(summarizeSignalSource({ props: createSignalSourceProps('analog', { waveType: 'sine', amplitude: '1.0', unit: 'V', frequency: '10Hz' }) }))
      .toBe('模拟 · sine · 1.0V · 10Hz');
    expect(summarizeSignalSource({ props: createSignalSourceProps('rf', { centerFrequency: '2.4GHz', bandwidth: '20MHz', modulation: 'QPSK' }) }))
      .toBe('射频 · 2.4GHz · 20MHz · QPSK');
  });

  it('selects numeric scalar fallbacks for backend execution', () => {
    expect(getSignalSourceScalarFallback({ signalDomain: 'analog', value: '1.5', amplitude: '2' })).toBe(1.5);
    expect(getSignalSourceScalarFallback({ signalDomain: 'digital', initialState: '1' })).toBe(1);
    expect(getSignalSourceScalarFallback({ signalDomain: 'command', payloadValue: '7' })).toBe(7);
    expect(getSignalSourceScalarFallback({ signalDomain: 'rf', power: '10' })).toBe(10);
    expect(getSignalSourceScalarFallback({ signalDomain: 'rf', power: '10dBm' })).toBe(0);
  });
});
