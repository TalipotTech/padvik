/// <reference types="next" />

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
