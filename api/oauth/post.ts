import createAPIGatewayProxyHandler from "samepage/backend/createAPIGatewayProxyHandler";
import axios from "axios";

const logic = async ({ code, state: _ }: { code: string; state: string }) => {
  const { data } = await axios.post(
    `https://api.notion.com/v1/oauth/token`,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri:
        process.env.NODE_ENV === "production"
          ? "https://samepage.network/oauth/notion"
          : "https://samepage.ngrok.io/oauth/notion",
    },
    {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
        ).toString("base64")}`,
      },
    }
  );
  return {
    accessToken: data.access_token,
    app: 4,
    workspace: data.workspace_id,
    label: data.workspace_name,
    suggestExtension: true,
    postInstall: true,
  };
};

export default createAPIGatewayProxyHandler(logic);
