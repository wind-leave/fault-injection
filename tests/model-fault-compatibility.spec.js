import { describe, expect, it } from 'vitest';
import faultCatalog from '../fault-types/fault-type-catalog.json';
import evtolHierarchicalPackage from '../public/model-packages/evtol_small_nonlinear_hierarchical.json';
import {
  createFlightModelPackageDescriptor
} from '../src/services/flightModelPackageService.js';
import {
  UAV_FLIGHT_CONTROL_FAULT_LIBRARY_ID,
  UAV_FLIGHT_CONTROL_SYSTEM_FAMILY,
  describeModelFaultCompatibility,
  filterCompatibleFaultTypes,
  getModelFaultLibraryIds,
  getModelSystemFamily,
  isFaultCompatibleWithModel,
  isFaultLibraryCompatibleWithModel
} from '../src/services/modelFaultCompatibilityService.js';

describe('model/fault-library compatibility', () => {
  it('declares UAV flight-control compatibility on the hierarchical model package', () => {
    expect(evtolHierarchicalPackage.systemFamily).toBe(UAV_FLIGHT_CONTROL_SYSTEM_FAMILY);
    expect(evtolHierarchicalPackage.supportedFaultLibraries).toContain(UAV_FLIGHT_CONTROL_FAULT_LIBRARY_ID);
    expect(getModelSystemFamily(evtolHierarchicalPackage)).toBe(UAV_FLIGHT_CONTROL_SYSTEM_FAMILY);
    expect(getModelFaultLibraryIds(evtolHierarchicalPackage)).toEqual([UAV_FLIGHT_CONTROL_FAULT_LIBRARY_ID]);
  });

  it('offers the PDF-derived UAV fault catalog only to compatible models', () => {
    const compatibleFaults = filterCompatibleFaultTypes(faultCatalog, evtolHierarchicalPackage);

    expect(isFaultLibraryCompatibleWithModel(faultCatalog, evtolHierarchicalPackage)).toBe(true);
    expect(compatibleFaults).toHaveLength(faultCatalog.faultTypes.length);
    expect(compatibleFaults.map((faultModel) => faultModel.id)).toContain('actuator_lock_or_failure');
  });

  it('blocks UAV flight-control faults for unrelated systems', () => {
    const unrelatedPackage = {
      schemaVersion: 1,
      packageType: 'thermal-plant-model',
      systemFamily: 'thermal-control',
      supportedFaultLibraries: [],
      modelId: 'thermal-loop',
      modelName: 'Thermal Loop',
      description: 'A non-flight-control plant model'
    };

    expect(getModelSystemFamily(unrelatedPackage)).toBe('thermal-control');
    expect(getModelFaultLibraryIds(unrelatedPackage)).toEqual([]);
    expect(isFaultLibraryCompatibleWithModel(faultCatalog, unrelatedPackage)).toBe(false);
    expect(isFaultCompatibleWithModel(faultCatalog.faultTypes[0], unrelatedPackage, faultCatalog)).toBe(false);
    expect(filterCompatibleFaultTypes(faultCatalog, unrelatedPackage)).toEqual([]);
  });

  it('keeps compatibility metadata in package descriptors', () => {
    const descriptor = createFlightModelPackageDescriptor(evtolHierarchicalPackage);

    expect(descriptor).toMatchObject({
      modelId: 'evtol-small-nonlinear-hierarchical',
      systemFamily: UAV_FLIGHT_CONTROL_SYSTEM_FAMILY,
      supportedFaultLibraries: [UAV_FLIGHT_CONTROL_FAULT_LIBRARY_ID]
    });
  });

  it('summarizes the active model compatibility state for UI use', () => {
    const summary = describeModelFaultCompatibility(evtolHierarchicalPackage, faultCatalog);

    expect(summary).toMatchObject({
      systemFamily: UAV_FLIGHT_CONTROL_SYSTEM_FAMILY,
      faultLibraryIds: [UAV_FLIGHT_CONTROL_FAULT_LIBRARY_ID],
      compatible: true
    });
    expect(summary.compatibleFaultTypes.length).toBe(faultCatalog.faultTypes.length);
  });
});
