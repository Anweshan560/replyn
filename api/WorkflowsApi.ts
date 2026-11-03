import type { APIRequestContext, APIResponse } from '@playwright/test';
import { ENDPOINTS, ResourceApi, type HeadersProvider } from './ResourceApi';
import { TEST_DATA_MARKER, type WorkflowData } from '../utils/testData';
import { sendTimed } from '../utils/timing';

/** One node on the workflow canvas. `next` holds the ids of the steps that follow. */
export type WorkflowStep = {
  id: string;
  type: 'trigger' | 'action' | 'condition';
  nodeType: string;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  next: string[];
};

export type WorkflowPayload = {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  triggerStrategy?: { type: string; conditions: Record<string, unknown> };
  steps?: WorkflowStep[];
};

export type WorkflowRecord = Required<Omit<WorkflowPayload, 'description'>> & {
  id: string;
  description: string | null;
  /** Problems that stop the workflow from being activated, e.g. "must have at least one action step". */
  validationErrors: { message: string }[] | null;
  /** Set when the workflow is archived. */
  deletedAt: string | null;
  createdAt: string;
};

/** The list's filters, as the Workflows page sends them. */
export type WorkflowFilters = {
  search?: string;
  /** The Active and Paused tabs. */
  isActive?: boolean;
  /** The Archived tab. */
  archived?: boolean;
  /** The "All triggers" filter, e.g. "manual_trigger". */
  triggerType?: string;
  page?: number;
  limit?: number;
};

export type WorkflowAnalytics = {
  totalExecutions: number;
  successRate: number;
  activeWorkflows: number;
  totalWorkflows: number;
  failedExecutions: number;
};

/**
 * A workflow that starts only when someone starts it by hand (Manual trigger) and whose only step
 * ends it (Exit Workflow), so it can never message or change a contact. With `actionStep: false`
 * it has the trigger alone, which the app reports as a validation error and refuses to activate.
 */
export function toWorkflowPayload(workflow: WorkflowData, { actionStep = true } = {}): WorkflowPayload {
  const trigger: WorkflowStep = {
    id: 'trigger',
    type: 'trigger',
    nodeType: 'manual_trigger',
    label: 'Manual Trigger',
    config: {},
    position: { x: 300, y: 0 },
    next: actionStep ? ['exit'] : [],
  };
  const exit: WorkflowStep = {
    id: 'exit',
    type: 'action',
    nodeType: 'exit',
    label: 'Exit Workflow',
    config: {},
    position: { x: 300, y: 170 },
    next: [],
  };
  return {
    name: workflow.name,
    description: workflow.description,
    isActive: false,
    triggerStrategy: { type: 'manual_trigger', conditions: {} },
    steps: actionStep ? [trigger, exit] : [trigger],
  };
}

/**
 * Workflows (the list page; the canvas editor is tested by hand).
 *
 * DELETE does not delete: it archives (the record answers 404 afterwards and is listed with
 * `?archived=true`), and there is no way to delete for good. So that test runs don't fill the
 * Archived tab, `createRecord` brings back an archived test workflow and reuses it when it can.
 */
export class WorkflowsApi extends ResourceApi<WorkflowPayload, WorkflowRecord> {
  constructor(request: APIRequestContext, headers: HeadersProvider) {
    super(request, headers, ENDPOINTS.workflows);
  }

  /** GET the list with the page's filters. */
  async listFiltered(filters: WorkflowFilters): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.get(this.url(), { headers, params: { page: 1, limit: 20, ...filters } }),
    );
  }

  /** Every workflow that matches `filters`, across all pages. */
  async listFilteredRecords(filters: WorkflowFilters): Promise<WorkflowRecord[]> {
    const records: WorkflowRecord[] = [];
    for (let page: number | null = 1; page;) {
      const data: { result: WorkflowRecord[]; meta: { nextPage: number | null } } = (
        await (await this.listFiltered({ limit: 100, ...filters, page })).json()
      ).data;
      records.push(...data.result);
      page = data.meta.nextPage;
    }
    return records;
  }

  /** Turn a workflow on (the Live switch). Refused with 400 while it has validation errors. */
  async activate(id: string): Promise<APIResponse> {
    return this.post(`${id}/activate`);
  }

  /** Pause a workflow (the Live switch). */
  async deactivate(id: string): Promise<APIResponse> {
    return this.post(`${id}/deactivate`);
  }

  /** Bring an archived workflow back. It comes back paused. */
  async restore(id: string): Promise<APIResponse> {
    return this.post(`${id}/restore`);
  }

  /** The numbers at the top of the Workflows page. */
  async analytics(): Promise<APIResponse> {
    return this.getPath('analytics');
  }

  /** The triggers, actions and conditions the canvas offers. */
  async nodes(): Promise<APIResponse> {
    return this.getPath('nodes');
  }

  /** The ready-made workflows under "Start from a template". */
  async templates(): Promise<APIResponse> {
    return this.getPath('templates');
  }

  /**
   * A workflow for test setup, paused. Reuses an archived test workflow (restored and overwritten
   * with `payload`) when there is one, and creates a new one otherwise.
   */
  override async createRecord(payload: WorkflowPayload): Promise<WorkflowRecord> {
    const archived = await this.listFilteredRecords({ archived: true });
    for (const old of archived.filter((workflow) => TEST_DATA_MARKER.test(workflow.name))) {
      // Another test running at the same time may have taken this one: try the next.
      if (!(await this.restore(old.id)).ok()) continue;
      const updated = await this.update(old.id, { ...payload, isActive: false });
      if (updated.ok()) return (await updated.json()).data;
      await this.delete(old.id);
    }
    return super.createRecord(payload);
  }

  private async post(path: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.post(`${this.url()}/${path}`, { headers }));
  }

  private async getPath(path: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.get(`${this.url()}/${path}`, { headers }));
  }
}
