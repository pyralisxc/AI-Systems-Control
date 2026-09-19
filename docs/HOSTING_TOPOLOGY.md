# Hosting Topology

Status: **Frozen for initial web implementation**  
Decision date: **2026-09-18**

## Decision

AI Systems Control and Development Intelligence are deployed as separate Vercel projects inside the existing Vercel team.

- **AI Systems Control Vercel project:** create new project `ai-systems-control`.
- **Development Intelligence Vercel project:** continue using existing `development-intelligence`.
- **CardForge and other products:** remain independent deployments.

## Why separate projects

ASC is the canonical owner-facing application. Development Intelligence is a specialist evidence service. They must be able to deploy, roll back, scale, authenticate, and fail independently.

Putting ASC into the existing DI Vercel project would create the wrong operational ownership:
- an ASC UI release could accidentally redeploy the DI evidence service;
- a DI engine rollback could roll back the owner website;
- environment variables and credentials would become unnecessarily shared;
- service health and website health would become harder to distinguish;
- specialist-system independence would erode into a deployment monolith.

## Product topology

```text
Owner / operator
      |
      v
AI Systems Control
(canonical website)
      |
      +--> Development Intelligence
      |    (evidence / project-reality service)
      |
      +--> Development OS
      |    (reasoning authority)
      |
      +--> Conductor
           (orchestration authority)
```

ASC owns navigation and integrated presentation. Specialist systems own their domain truth and execution semantics.

## Authentication posture

Human authentication belongs primarily at the ASC application boundary.

ASC-to-specialist communication should use narrowly scoped server-side service credentials where appropriate. Development Intelligence may continue to expose OAuth for independent external clients such as ChatGPT while accepting a trusted machine credential for ASC.

Browser code must not receive specialist service credentials.

## Domain posture

The deployments may share a product/domain family while remaining operationally independent. Exact public hostnames are deferred until the ASC web shell is ready to deploy.

The existing stable DI hostname should not be repurposed for ASC.

## Migration rule

Do not remove or degrade the DI Workbench while migrating its human workflows into ASC. Retire a DI human workflow from primary use only after ASC demonstrates equivalent or intentionally better access with preserved evidence and uncertainty semantics.
