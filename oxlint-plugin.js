const preferOptionFromNullable = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer Option.fromNullable over ternary with Option.some/none",
    },
    fixable: "code",
    messages: {
      preferFromNullable: "Use Option.fromNullable({{name}}) instead of Option.some/Option.none.",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;

    const isNullLiteral = (node) => node?.type === "Literal" && node.value === null;
    const isUndefinedIdentifier = (node) => node?.type === "Identifier" && node.name === "undefined";
    const isVoidZero = (node) =>
      node?.type === "UnaryExpression" &&
      node.operator === "void" &&
      node.argument?.type === "Literal" &&
      node.argument.value === 0;

    const isNullishLiteral = (node) => isNullLiteral(node) || isUndefinedIdentifier(node) || isVoidZero(node);
    const isOptionMember = (callee, name) =>
      callee?.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      callee.object.name === "Option" &&
      callee.property.type === "Identifier" &&
      callee.property.name === name;

    const unwrapInstantiation = (callee) => (callee?.type === "TSInstantiationExpression" ? callee.expression : callee);
    const getTestedName = (test) => {
      if (test.left.type === "Identifier" && isNullishLiteral(test.right)) {
        return test.left.name;
      }

      if (test.right.type === "Identifier" && isNullishLiteral(test.left)) {
        return test.right.name;
      }

      if (test.left.type === "MemberExpression" && isNullishLiteral(test.right)) {
        return sourceCode.getText(test.left);
      }

      if (test.right.type === "MemberExpression" && isNullishLiteral(test.left)) {
        return sourceCode.getText(test.right);
      }

      return null;
    };

    const getReturnCall = (statement) => {
      if (!statement) return null;

      if (statement.type === "ReturnStatement") {
        return statement.argument?.type === "CallExpression" ? statement.argument : null;
      }

      if (
        statement.type === "BlockStatement" &&
        statement.body.length === 1 &&
        statement.body[0].type === "ReturnStatement"
      ) {
        const argument = statement.body[0].argument;
        return argument?.type === "CallExpression" ? argument : null;
      }

      return null;
    };

    const isOptionSomeCall = (call, testedName) => {
      if (!call) return false;
      const callee = unwrapInstantiation(call.callee);
      if (!isOptionMember(callee, "some")) return false;
      const arg = call.arguments[0];
      if (!arg) return false;
      return sourceCode.getText(arg) === testedName;
    };

    const isOptionNoneCall = (call) => {
      if (!call) return false;
      const callee = unwrapInstantiation(call.callee);
      return isOptionMember(callee, "none");
    };

    const buildFromNullable = (testedName) => `Option.fromNullable(${testedName})`;

    return {
      ConditionalExpression(node) {
        const { test, consequent, alternate } = node;

        if (test.type !== "BinaryExpression") return;
        if (test.operator !== "!==" && test.operator !== "!=") return;

        const testedName = getTestedName(test);
        if (!testedName) return;

        if (consequent.type !== "CallExpression") return;
        if (!isOptionSomeCall(consequent, testedName)) return;

        if (alternate.type !== "CallExpression") return;
        if (!isOptionNoneCall(alternate)) return;

        context.report({
          node,
          messageId: "preferFromNullable",
          data: { name: testedName },
          fix(fixer) {
            return fixer.replaceText(node, buildFromNullable(testedName));
          },
        });
      },
      IfStatement(node) {
        const { test, consequent, alternate } = node;

        if (test.type !== "BinaryExpression") return;
        if (test.operator !== "!==" && test.operator !== "!=") return;

        const testedName = getTestedName(test);
        if (!testedName) return;

        const consequentCall = getReturnCall(consequent);
        if (!isOptionSomeCall(consequentCall, testedName)) return;

        const alternateCall = getReturnCall(alternate);
        let nextStatement = null;
        if (alternateCall) {
          if (!isOptionNoneCall(alternateCall)) return;
        } else {
          const parent = node.parent;
          if (!parent || parent.type !== "BlockStatement") return;
          const index = parent.body.indexOf(node);
          if (index < 0 || index + 1 >= parent.body.length) return;
          nextStatement = parent.body[index + 1];
          const nextReturn = getReturnCall(nextStatement);
          if (!isOptionNoneCall(nextReturn)) return;
        }

        context.report({
          node,
          messageId: "preferFromNullable",
          data: { name: testedName },
          fix(fixer) {
            if (!node.range) return null;
            const replacement = `return ${buildFromNullable(testedName)};`;

            if (alternateCall) {
              return fixer.replaceText(node, replacement);
            }

            if (!nextStatement?.range) return null;
            return fixer.replaceTextRange([node.range[0], nextStatement.range[1]], replacement);
          },
        });
      },
    };
  },
};

const noGlobalErrorInEffectFail = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow using global Error constructor with Effect.fail (use Schema.TaggedError instead)",
    },
    messages: {
      noGlobalErrorInFail:
        "Do not use Effect.fail(new Error(...)). Use Schema.TaggedError or a typed error class for type safety.",
    },
    schema: [],
  },
  create(context) {
    const effectFailMethods = new Set(["fail", "failSync", "failCause", "failCauseSync", "die", "dieSync"]);

    const isEffectFailCall = (node) => {
      if (node.type !== "CallExpression") return false;
      const callee = node.callee;
      if (callee.type !== "MemberExpression") return false;
      if (callee.object.type !== "Identifier" || callee.object.name !== "Effect") return false;
      if (callee.property.type !== "Identifier") return false;
      return effectFailMethods.has(callee.property.name);
    };

    const isGlobalErrorConstructor = (node) =>
      node.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "Error";

    return {
      CallExpression(node) {
        if (!isEffectFailCall(node)) return;
        for (const arg of node.arguments) {
          if (isGlobalErrorConstructor(arg)) {
            context.report({
              node: arg,
              messageId: "noGlobalErrorInFail",
            });
          }
        }
      },
    };
  },
};

const preferPredicateHasProperty = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Prefer Predicate.hasProperty over 'in' operator for property checks",
    },
    messages: {
      preferHasProperty:
        "Use Predicate.hasProperty from 'effect' instead of 'in' operator: Predicate.hasProperty({{object}}, '{{property}}')",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;

    return {
      BinaryExpression(node) {
        if (node.operator !== "in") return;

        const property = node.left;
        const object = node.right;

        // Get the property as a string (handles both string literals and identifiers)
        let propertyText;
        if (property.type === "Literal" && typeof property.value === "string") {
          propertyText = property.value;
        } else if (property.type === "Identifier") {
          propertyText = property.name;
        } else {
          propertyText = sourceCode.getText(property);
        }

        const objectText = sourceCode.getText(object);

        context.report({
          node,
          messageId: "preferHasProperty",
          data: { object: objectText, property: propertyText },
        });
      },
    };
  },
};

const noGlobalFetch = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow using global fetch (use @effect/platform HttpClient instead)",
    },
    messages: {
      noGlobalFetch: "Do not use global fetch. Use @effect/platform HttpClient for Effect-native HTTP requests.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "fetch") {
          context.report({
            node,
            messageId: "noGlobalFetch",
          });
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: "effect-inngest",
  },
  rules: {
    "prefer-option-from-nullable": preferOptionFromNullable,
    "no-global-error-in-effect-fail": noGlobalErrorInEffectFail,
    "no-global-fetch": noGlobalFetch,
    "prefer-predicate-has-property": preferPredicateHasProperty,
  },
};

export default plugin;
