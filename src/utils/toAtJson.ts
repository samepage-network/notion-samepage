import { Annotation, InitialSchema } from "samepage/internal/types";
import { combineAtJsons, NULL_TOKEN } from "samepage/utils/atJsonParser";
import type {
  RichTextItemResponse,
  AnnotationResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { Client as NotionClient } from "@notionhq/client";

const getAnnotations = (annotations: AnnotationResponse, end: number) =>
  ([] as Annotation[])
    .concat(annotations.bold ? [{ type: "bold" as const, start: 0, end }] : [])
    .concat(
      annotations.italic ? [{ type: "italics" as const, start: 0, end }] : []
    )
    .concat(
      annotations.strikethrough
        ? [
            {
              type: "strikethrough" as const,
              start: 0,
              end,
            },
          ]
        : []
    )
    .concat(
      annotations.code ? [{ type: "inline" as const, start: 0, end }] : []
    )
    .concat(
      annotations.underline
        ? [] // [{ type: "underline" as const, start: 0, end: content.length }]
        : []
    )
    .concat(
      annotations.color
        ? [] // [{ type: "color" as const, start: 0, end: content.length }]
        : []
    );

export const richTextToAtJson = (
  richText: RichTextItemResponse,
  notebookUuid: string
): InitialSchema => {
  switch (richText.type) {
    case "text": {
      const {
        text: { content },
        annotations,
      } = richText;
      return {
        content,
        annotations: getAnnotations(annotations, content.length),
      };
    }
    case "mention": {
      const content = richText.plain_text || NULL_TOKEN;
      return {
        content,
        annotations: getAnnotations(
          richText.annotations,
          content.length
        ).concat({
          type: "reference",
          start: 0,
          end: content.length,
          attributes: {
            notebookPageId:
              richText.mention.type === "page"
                ? richText.mention.page.id
                : richText.mention.type === "database"
                ? richText.mention.database.id
                : richText.mention.type === "user"
                ? richText.mention.user.id
                : richText.mention.type === "date"
                ? richText.mention.date.start
                : richText.mention.type === "link_preview"
                ? richText.mention.link_preview.url
                : richText.mention.type === "template_mention"
                ? richText.mention.template_mention.type ===
                  "template_mention_date"
                  ? richText.mention.template_mention.template_mention_date
                  : richText.mention.template_mention.template_mention_user
                : "",
            notebookUuid,
          },
        }),
      };
    }
    case "equation": {
      const content = richText.equation.expression;
      return {
        content,
        annotations: getAnnotations(richText.annotations, content.length),
      };
    }
    default:
      // @ts-expect-error
      throw new Error(`Unknown rich text type: ${richText.type}`);
  }
};

const blockContentToAtJson = ({
  rich_text,
  offset,
  notebookUuid,
}: {
  rich_text: RichTextItemResponse[];
  offset: number;
  notebookUuid: string;
}) => {
  const { content: _content, annotations } = combineAtJsons(
    rich_text.map((rt) => richTextToAtJson(rt, notebookUuid))
  );
  const content = `${_content}\n`;
  const end = content.length + offset;
  return {
    content,
    annotations: annotations.map((a) => ({
      ...a,
      start: a.start + offset,
      end: a.end + offset,
    })),
    end,
  };
};

const toAtJson = ({
  block_id,
  startIndex = 0,
  level = 0,
  notebookUuid,
  notionClient,
}: {
  block_id: string;
  startIndex?: number;
  level?: number;
  notebookUuid: string;
  notionClient: NotionClient;
}): Promise<InitialSchema> =>
  notionClient.blocks.children.list({ block_id }).then((r) =>
    r.results
      .map((n) => async (offset: number) => {
        if (!("type" in n)) return { content: "", annotations: [] };
        const parseBlock = (): InitialSchema => {
          if (n.type === "paragraph") {
            const { content, annotations, end } = blockContentToAtJson({
              rich_text: n.paragraph.rich_text,
              offset,
              notebookUuid,
            });
            return {
              content,
              annotations: (
                [
                  {
                    start: offset,
                    end,
                    attributes: {
                      level,
                      viewType: "document",
                    },
                    type: "block" as const,
                  },
                ] as Annotation[]
              ).concat(annotations),
            };
          } else if (n.type === "bulleted_list_item") {
            const { content, annotations, end } = blockContentToAtJson({
              rich_text: n.bulleted_list_item.rich_text,
              offset,
              notebookUuid,
            });
            return {
              content,
              annotations: (
                [
                  {
                    start: offset,
                    end,
                    attributes: {
                      level,
                      viewType: "bullet",
                    },
                    type: "block" as const,
                  },
                ] as Annotation[]
              ).concat(annotations),
            };
          } else if (n.type === "numbered_list_item") {
            const { content, annotations, end } = blockContentToAtJson({
              rich_text: n.numbered_list_item.rich_text,
              offset,
              notebookUuid,
            });
            return {
              content,
              annotations: (
                [
                  {
                    start: offset,
                    end,
                    attributes: {
                      level,
                      viewType: "numbered",
                    },
                    type: "block" as const,
                  },
                ] as Annotation[]
              ).concat(annotations),
            };
          } else if (n.type === "to_do") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "audio") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "bookmark") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "code") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "divider") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "breadcrumb") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "file") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "embed") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "callout") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "image") {
            return { content: "", annotations: [] };
          } else if (n.type === "video") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "pdf") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "table_of_contents") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "toggle") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "child_page") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "child_database") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "column_list") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "column") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "quote") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "equation") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "heading_1") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "heading_2") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "heading_3") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "link_preview") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "link_to_page") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "template") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "synced_block") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "table") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "table_row") {
            // TODO
            return { content: "", annotations: [] };
          } else if (n.type === "unsupported") {
            // TODO
            return { content: "", annotations: [] };
          } else {
            return { content: "", annotations: [] };
          }
        };
        const { content, annotations } = parseBlock();
        const { content: childrenContent, annotations: childrenAnnotations } =
          n.has_children
            ? await toAtJson({
                block_id: n.id,
                level: level + 1,
                startIndex: content.length,
                notebookUuid,
                notionClient,
              })
            : { content: "", annotations: [] };
        return {
          content: `${content}${childrenContent}`,
          annotations: annotations.concat(childrenAnnotations),
        };
      })
      .reduce(
        (p, c) =>
          p.then(({ content: pc, annotations: pa }) =>
            c(startIndex + pc.length).then(
              ({ content: cc, annotations: ca }) => ({
                content: `${pc}${cc}`,
                annotations: pa.concat(ca),
              })
            )
          ),
        Promise.resolve<InitialSchema>({
          content: "",
          annotations: [],
        })
      )
  );

export default toAtJson;
