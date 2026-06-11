import assert from "node:assert/strict";
import { test } from "node:test";

// Uses the built @penguin/core bundle (same precedent as mcp-release-bundle
// tests) because proto-parser imports protobufjs, which a transpile-to-data-URL
// load can't resolve.
async function loadCore() {
  return import(new URL("../packages/core/dist/index.js", import.meta.url));
}

// protoc-gen-es names nested messages with underscore joins:
// `message GetPlayerProfileByJwtRes { message Player {...} }` becomes the
// class GetPlayerProfileByJwtRes_Player, while the @generated comment refers
// to it as player.GetPlayerProfileByJwtRes.Player.
const CONNECT_DTS = `
import { MethodKind } from "@bufbuild/protobuf";
export declare const PlayerService: {
  readonly typeName: "player.PlayerService";
  readonly methods: {
    readonly getPlayerProfileByJwt: {
      readonly name: "GetPlayerProfileByJwt";
      readonly I: typeof GetPlayerProfileByJwtReq;
      readonly O: typeof GetPlayerProfileByJwtRes;
      readonly kind: MethodKind.Unary;
    };
  };
};
`;

const PB_DTS = `
export declare class BaseResponse extends Message<BaseResponse> {
  /**
   * @generated from field: common.StatusCode status = 1;
   */
  status: number;

  /**
   * @generated from field: string message = 2;
   */
  message: string;
}

export declare class GetPlayerProfileByJwtReq extends Message<GetPlayerProfileByJwtReq> {
}

export declare class GetPlayerProfileByJwtRes extends Message<GetPlayerProfileByJwtRes> {
  /**
   * @generated from field: common.BaseResponse baseResponse = 1;
   */
  baseResponse?: BaseResponse;

  /**
   * @generated from field: player.GetPlayerProfileByJwtRes.Player data = 2;
   */
  data?: GetPlayerProfileByJwtRes_Player;
}

export declare class GetPlayerProfileByJwtRes_Player extends Message<GetPlayerProfileByJwtRes_Player> {
  /**
   * @generated from field: string nickname = 1;
   */
  nickname: string;

  /**
   * @generated from field: int64 balance = 2;
   */
  balance: bigint;
}
`;

test("connect d.ts parsing resolves nested message types (Class_Nested naming)", async () => {
  const { parseProtoContent } = await loadCore();

  const services = parseProtoContent([
    { name: "player_connect.d.ts", content: CONNECT_DTS },
    { name: "player_pb.d.ts", content: PB_DTS },
  ]);

  assert.equal(services.length, 1);
  const method = services[0].methods.find((m) => m.name === "GetPlayerProfileByJwt");
  assert.ok(method, "method parsed");

  const base = method.responseFields.find((f) => f.name === "baseResponse");
  assert.ok(base?.fields?.length, "top-level referenced message resolves (existing behavior)");

  // The regression: nested message types were looked up by their last dotted
  // segment ("Player") instead of the protoc class name
  // ("GetPlayerProfileByJwtRes_Player"), so fields came back empty and the
  // Proto Viewer could not expand them.
  const data = method.responseFields.find((f) => f.name === "data");
  assert.ok(data, "data field parsed");
  assert.ok(
    data.fields && data.fields.length > 0,
    "nested message field must resolve its subfields",
  );
  assert.deepEqual(
    data.fields.map((f) => f.name).sort(),
    ["balance", "nickname"],
  );
});

test("self-referencing messages do not recurse infinitely", async () => {
  const { parseProtoContent } = await loadCore();

  const services = parseProtoContent([
    {
      name: "tree_connect.d.ts",
      content: `
export declare const TreeService: {
  readonly typeName: "tree.TreeService";
  readonly methods: {
    readonly getTree: {
      readonly name: "GetTree";
      readonly I: typeof Node;
      readonly O: typeof Node;
      readonly kind: MethodKind.Unary;
    };
  };
};
`,
    },
    {
      name: "tree_pb.d.ts",
      content: `
export declare class Node extends Message<Node> {
  /**
   * @generated from field: string id = 1;
   */
  id: string;

  /**
   * @generated from field: tree.Node parent = 2;
   */
  parent?: Node;
}
`,
    },
  ]);

  const method = services[0]?.methods[0];
  assert.ok(method, "cyclic schema still parses");
  const parent = method.requestFields.find((f) => f.name === "parent");
  assert.ok(parent, "self-referencing field present");
});
