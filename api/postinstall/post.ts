import createAPIGatewayProxyHandler from "samepage/backend/createAPIGatewayProxyHandler";
import { Client as NotionClient } from "@notionhq/client";

const logic = async ({
  accessToken,
  notebookUuid,
  token,
}: {
  accessToken: string;
  notebookUuid: string;
  token: string;
}) => {
  const notionClient = new NotionClient({
    auth: accessToken,
  });
  const pages = await notionClient.search({
    query: "Welcome to SamePage",
    filter: {
      property: "object",
      value: "page",
    },
  });
  if (pages.results.length === 0)
    return {
      success: false,
      reason: `Could not find "Welcome to SamePage" page.`,
    };
  const [page] = pages.results;
  const blocks = await notionClient.blocks.children.list({
    block_id: page.id,
  });
  const embedBlock = blocks.results.find(
    (block) =>
      "type" in block &&
      block.type === "embed" &&
      /^https:\/\/samepage.(network|ngrok\.io)\/embeds$/.test(block.embed.url)
  );
  if (!embedBlock)
    return {
      success: false,
      reason: `Could not find SamePage widget on Welcome page.`,
    };
  await notionClient.blocks.update({
    block_id: embedBlock.id,
    type: "embed",
    embed: {
      // @ts-ignore guaranteed to be embed
      ...embedBlock.embed,
      // @ts-ignore guaranteed to be embed
      url: `${embedBlock.embed.url}?auth=${Buffer.from(
        `${notebookUuid}:${token}`
      ).toString("base64")}`,
    },
  });

  return {
    success: true,
  };
};

export default createAPIGatewayProxyHandler(logic);
