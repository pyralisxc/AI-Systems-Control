# Web Foundation Boundary

## Decision

The reusable website-development foundation discovered through the CardForge hardening work remains a **separate foundation**, not a subdomain of AI Systems Control.

The strategic goal is cumulative development: mature interaction patterns, design/runtime primitives, infrastructure seams, and maintainability improvements should become reusable "Lego bricks" for future websites rather than being rebuilt from zero.

## Source-first extraction rule

Reusable primitives are extracted from proven source implementations after their ownership and behavior are understood.

Do:
- identify the stable primitive in the mature product;
- preserve behavior and accessibility;
- separate product-specific policy from reusable mechanism;
- create a canonical reusable owner for the primitive;
- migrate callers to that owner;
- remove duplicate implementations after parity.

Do not:
- copy large product surfaces into a generic package before the ownership seam is known;
- create parallel wrappers that preserve duplication;
- let AI Systems Control become the repository for unrelated UI primitives.

## Relationship to AI Systems Control

AI Systems Control can:
- use the Web Foundation to build its own interface;
- register Web Foundation capabilities/status as part of a Project;
- surface extraction or upgrade work through Actions/Conductor;
- observe projects that consume the foundation.

AI Systems Control does not own:
- design systems;
- generic component libraries;
- website-generation templates;
- CardForge-specific product behavior.

## CardForge lineage

CardForge is a high-value source implementation because it already contains mature interactive behavior. Future extraction should preserve the prior hardening direction: explicit ownership, a reusable action/tool runtime seam, consolidated generation behavior, and source-first migration instead of parallel feature reimplementation.
