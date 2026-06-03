export { Parser, parse, TokenCursor, type ParseResult } from "./parser.js";
export { parseExpression } from "./pratt.js";
export {
  parseBlock,
  parseBlockItem,
  parseElementDecl,
  parseAttrList,
  parseAttribute,
  parseDecorator,
  parseDirective,
} from "./statements.js";
export {
  parseFile,
  parseTopLevelDecl,
  parseUsingDecl,
  parseParameters,
  parseTypeRef,
} from "./declarations.js";
export { synchronize } from "./recovery.js";
