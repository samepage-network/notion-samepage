import { Annotation, InitialSchema } from "samepage/internal/types";
import notionClient from "./notionClient";
import { combineAtJsons, NULL_TOKEN } from "samepage/utils/atJsonParser";
import type {
  RichTextItemResponse,
  AnnotationResponse,
} from "@notionhq/client/build/src/api-endpoints";

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

const richTextToAtJson = (
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
  const content = _content || NULL_TOKEN;
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
}: {
  block_id: string;
  startIndex?: number;
  level?: number;
  notebookUuid: string;
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
