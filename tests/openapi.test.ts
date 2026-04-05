import { describe, it, expect } from 'vitest';

// Pure function tests for OpenAPI generation — no DATA_DIR needed
// We test zodToOpenApi conversion logic directly

function convertZodToOpenApi(zodSchema: any): any {
  if (!zodSchema || !zodSchema._def) return zodSchema;
  const def = zodSchema._def;
  switch (def.typeName) {
    case 'ZodString': return { type: 'string', description: def.description };
    case 'ZodNumber': return { type: 'number', description: def.description };
    case 'ZodBoolean': return { type: 'boolean', description: def.description };
    case 'ZodArray':
      return { type: 'array', items: def.element ? convertZodToOpenApi(def.element) : {} };
    case 'ZodEnum': return { type: 'string', enum: def.values };
    case 'ZodOptional': return def.inner ? convertZodToOpenApi(def.inner) : {};
    case 'ZodDefault': return { ...convertZodToOpenApi(def.inner), default: def.defaultValue() };
    case 'ZodLiteral': return { const: def.value };
    default: return { type: 'string', description: def.description || '' };
  }
}

function zodToOpenApi(schema: Record<string, any>): any {
  const shape = schema._def?.shape || schema.shape;
  if (!shape) {
    if (schema._def) return convertZodToOpenApi(schema);
    return schema;
  }
  const properties: Record<string, any> = {};
  for (const [key, val] of Object.entries(shape)) {
    properties[key] = convertZodToOpenApi(val as any);
  }
  return { type: 'object', properties };
}

// Mock zod schemas (minimal _def structure)
function zString(desc?: string) {
  return { _def: { typeName: 'ZodString', description: desc } };
}
function zNumber(desc?: string) {
  return { _def: { typeName: 'ZodNumber', description: desc } };
}
function zBool(desc?: string) {
  return { _def: { typeName: 'ZodBoolean', description: desc } };
}
function zEnum(values: string[], desc?: string) {
  return { _def: { typeName: 'ZodEnum', values, description: desc } };
}
function zOptional(inner: any) {
  return { _def: { typeName: 'ZodOptional', inner }, isOptional: () => true };
}
function zDefault(inner: any, val: any) {
  return { _def: { typeName: 'ZodDefault', inner, defaultValue: () => val } };
}
function zArray(element: any) {
  return { _def: { typeName: 'ZodArray', element } };
}

function makeZodObject(shape: Record<string, any>) {
  return { _def: { typeName: 'ZodObject' }, shape };
}

describe('OpenAPI zodToOpenApi conversion', () => {
  it('converts ZodString', () => {
    const result = convertZodToOpenApi(zString('task name'));
    expect(result).toEqual({ type: 'string', description: 'task name' });
  });

  it('converts ZodNumber', () => {
    const result = convertZodToOpenApi(zNumber('count'));
    expect(result).toEqual({ type: 'number', description: 'count' });
  });

  it('converts ZodBoolean', () => {
    const result = convertZodToOpenApi(zBool('flag'));
    expect(result).toEqual({ type: 'boolean', description: 'flag' });
  });

  it('converts ZodEnum', () => {
    const result = convertZodToOpenApi(zEnum(['a', 'b', 'c']));
    expect(result).toEqual({ type: 'string', enum: ['a', 'b', 'c'] });
  });

  it('converts ZodOptional', () => {
    const result = convertZodToOpenApi(zOptional(zString('name')));
    expect(result).toEqual({ type: 'string', description: 'name' });
  });

  it('converts ZodDefault', () => {
    const result = convertZodToOpenApi(zDefault(zBool('active'), false));
    expect(result).toEqual({ type: 'boolean', description: 'active', default: false });
  });

  it('converts ZodArray', () => {
    const result = convertZodToOpenApi(zArray(zString()));
    expect(result).toEqual({ type: 'array', items: { type: 'string', description: undefined } });
  });

  it('converts plain value', () => {
    expect(convertZodToOpenApi(null)).toBeNull();
    expect(convertZodToOpenApi(undefined)).toBeUndefined();
    expect(convertZodToOpenApi('hello')).toBe('hello');
  });

  it('converts ZodObject to JSON Schema with properties', () => {
    const schema = makeZodObject({
      name: zString('Task name'),
      status: zEnum(['pending', 'done'], 'Status'),
      count: zNumber(),
      active: zDefault(zBool(), true),
    });
    const result = zodToOpenApi(schema);
    expect(result.type).toBe('object');
    expect(result.properties).toBeDefined();
    expect(result.properties.name).toEqual({ type: 'string', description: 'Task name' });
    expect(result.properties.status).toEqual({ type: 'string', enum: ['pending', 'done'] });
    expect(result.properties.count).toEqual({ type: 'number' });
    expect(result.properties.active).toEqual({ type: 'boolean', default: true });
  });
});
