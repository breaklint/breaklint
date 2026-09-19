import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)],
  );
}

export function assertPublicImports(root, allowed, directories) {
  const artifacts = directories.flatMap((dir) => files(resolve(root, dir)));
  assert.ok(artifacts.some((file) => file.endsWith(".d.ts")));
  for (const file of artifacts) {
    if (!/\.(?:ts|js|mjs)$/.test(file)) continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (ts.isExportDeclaration(node))
          assert.ok(node.exportClause, `wildcard export: ${file}`);
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
          specifier = node.moduleSpecifier.text;
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        specifier = node.argument.literal.text;
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        assert.ok(ts.isStringLiteral(node.arguments[0]));
        specifier = node.arguments[0].text;
      }
      if (specifier) {
        if (specifier.startsWith("."))
          assert.ok(
            !relative(root, resolve(dirname(file), specifier)).startsWith(".."),
            `${file}: ${specifier}`,
          );
        else
          assert.ok(
            specifier.startsWith("node:") || allowed.has(specifier),
            `${file}: ${specifier}`,
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}

export function exportedNames(entry) {
  const program = ts.createProgram([entry], { noResolve: true });
  const checker = program.getTypeChecker();
  return checker
    .getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(entry)))
    .map((symbol) => symbol.name)
    .sort();
}
