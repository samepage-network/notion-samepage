import { Client as NotionClient } from "@notionhq/client";

const notionClient = new NotionClient({
  auth: process.env.NOTION_INTEGRATION_TOKEN,
});

export default notionClient;
