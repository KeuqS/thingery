import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, type ToolContext } from "./tools.js";

export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "thingery", version: "0.1.0" },
    {
      instructions:
        "Thingery is the open item database for second-hand goods. " +
        "Sellers authenticate with a Bearer thg_... API key to create and update listings; " +
        "search_items and get_item are public. Prices are integer cents.",
    },
  );
  registerTools(server, ctx);
  return server;
}
