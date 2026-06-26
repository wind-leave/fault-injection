# Layered Fault Binding Slot Display Design

## Goal

When a user binds a fault component to a target, the "associated parameter/signal" dropdown must show the user-facing slot name, such as `姿态控制增益`, instead of the internal variable key `controller_gain`.

## Scope

- Applies only to the layered fault binding dialog.
- Applies to the slot dropdown rendered under the associated parameter/signal field.
- Does not change saved data, slot ids, binding objects, target variables, fault instance payloads, or injection behavior.
- Does not change middle-variable behavior.

## Display Rule

Slot option labels should prefer user-facing names in this order:

1. `slotName`
2. `displayName`
3. `name`
4. `label`
5. existing technical binding name fallback from `getFaultSlotBindingObject(slot)`
6. `id` or `slotId`

For the attitude controller physical parameter slot, this makes the dropdown show `姿态控制增益` while the stored binding still targets `controller_gain`.

## Testing

Add a regression test that opens the layered fault binding dialog for the demo attitude controller and asserts:

- the slot dropdown contains `姿态控制增益`
- the slot dropdown does not display `controller_gain`
- confirming the dialog still saves the internal binding object as `controller_gain`

## Risks

The main risk is accidentally changing the data field used for binding. The implementation should add a display-label helper and leave the existing binding-object helper unchanged.
