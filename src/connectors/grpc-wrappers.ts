/**
 * connectors/grpc-wrappers.ts — gRPC service definition generation (INT-006)
 *
 * Generates protobuf service definitions from registered MCP tools.
 * Each tool becomes an RPC method: rpc ToolName(ToolRequest) returns (ToolResponse).
 * The generated .proto can be used with grpc-node or grpcurl.
 *
 * Note: this generates the schema only — actual gRPC server setup requires
 * a protobuf runtime (grpc-node). The schema is the contract.
 */

import type { ToolRegistry } from '../registry/tool-registry.js';

export interface ProtoService {
  serviceName: string;
  package: string;
  methods: Array<{
    name: string;
    inputType: string;
    outputType: string;
    description: string;
  }>;
  messages: Array<{
    name: string;
    fields: Array<{ name: string; type: string; repeated: boolean }>;
  }>;
}

/**
 * Generate a protobuf service definition from the tool registry.
 */
export function generateProtoSpec(
  registry: ToolRegistry,
  serviceName = 'McpTools',
  pkg = 'mcp.task.knowledge',
): ProtoService {
  const tools = registry.list({ offset: 0, limit: 100 });
  const methods: ProtoService['methods'] = [];
  const messages: ProtoService['messages'] = [];

  for (const tool of tools.data) {
    const inputType = `${tool.name}Request`;
    const outputType = `${tool.name}Response`;
    const inputKeys = tool.inputKeys ?? [];

    methods.push({
      name: tool.name,
      inputType,
      outputType,
      description: tool.description ?? tool.name,
    });

    messages.push({
      name: inputType,
      fields: inputKeys.map((k, i) => ({ name: k, type: 'string', repeated: false })),
    });

    messages.push({
      name: outputType,
      fields: [
        { name: 'ok', type: 'bool', repeated: false },
        { name: 'data', type: 'string', repeated: false },
        { name: 'error', type: 'string', repeated: false },
      ],
    });
  }

  return { serviceName, package: pkg, methods, messages };
}

/**
 * Render a ProtoService as a .proto file string.
 */
export function renderProto(spec: ProtoService): string {
  const lines: string[] = [
    `syntax = "proto3";`,
    '',
    `package ${spec.package};`,
    '',
    `service ${spec.serviceName} {`,
  ];

  for (const m of spec.methods) {
    lines.push(`  // ${m.description}`);
    lines.push(`  rpc ${m.name}(${m.inputType}) returns (${m.outputType});`);
  }
  lines.push('}');
  lines.push('');

  for (const msg of spec.messages) {
    lines.push(`message ${msg.name} {`);
    msg.fields.forEach((f, i) => {
      const repeated = f.repeated ? 'repeated ' : '';
      lines.push(`  ${repeated}${f.type} ${f.name} = ${i + 1};`);
    });
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
