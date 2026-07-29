export interface AutomationTrigger {
  id: string;
  name: string;
  description: string;
  samplePayload: Record<string, unknown>;
}

export interface AutomationAction {
  id: string;
  name: string;
  description: string;
  inputFields: ActionField[];
}

export interface ActionField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
}

export interface AutomationHook {
  platform: 'zapier' | 'make';
  hookUrl: string;
  event: string;
  userId: string;
  createdAt: Date;
}
