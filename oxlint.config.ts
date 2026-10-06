import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["oxc", "typescript", "import", "jsdoc", "promise"],
  categories: {
    correctness: "error",
  },
  options: {
    typeAware: true,
  },
});
