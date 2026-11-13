import { test as setup } from '../../../fixtures/test';

// Runs before the inbox tests (project "inbox-setup"). The workflow must be on before tomorrow
// morning's Instagram message arrives, so tests/inbox/workflows can check that it ran.
setup('switch on the workflow that notes customer-opened conversations', async ({ workflowsApi }) => {
  await workflowsApi.ensureInboundMessageWorkflow();
});
