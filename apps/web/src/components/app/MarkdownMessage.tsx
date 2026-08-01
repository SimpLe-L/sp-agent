import React from "react";
import { marked, type Token, type Tokens } from "marked";

type MarkdownMessageProps = {
  content: string;
};

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const tokens = marked.lexer(content, { breaks: true, gfm: true });
  return <div className="agentMarkdown">{renderBlocks(tokens)}</div>;
}

function renderBlocks(tokens: Token[]): React.ReactNode[] {
  return tokens.map((token, index) => <React.Fragment key={`${token.type}-${index}`}>{renderBlock(token)}</React.Fragment>);
}

function renderBlock(token: Token): React.ReactNode {
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      const className = heading.depth === 1 ? "agentMarkdownH1" : heading.depth === 2 ? "agentMarkdownH2" : "agentMarkdownH3";
      return <div className={className}>{renderInline(tokenChildren(heading))}</div>;
    }
    case "paragraph": {
      const paragraph = token as Tokens.Paragraph;
      return <p>{renderInline(tokenChildren(paragraph))}</p>;
    }
    case "blockquote": {
      const blockquote = token as Tokens.Blockquote;
      return <blockquote>{renderBlocks(tokenChildren(blockquote))}</blockquote>;
    }
    case "code":
      return <pre><code>{token.text}</code></pre>;
    case "list": {
      const list = token as Tokens.List;
      const List = list.ordered ? "ol" : "ul";
      return (
        <List start={list.ordered && list.start !== "" ? list.start : undefined}>
          {list.items.map((item: Tokens.ListItem, index: number) => <li key={index}>{renderBlocks(tokenChildren(item))}</li>)}
        </List>
      );
    }
    case "table": {
      const table = token as Tokens.Table;
      return (
        <div className="agentMarkdownTableWrap">
          <table>
            <thead><tr>{table.header.map((cell: Tokens.TableCell, index: number) => <th key={index}>{renderInline(tokenChildren(cell))}</th>)}</tr></thead>
            <tbody>{table.rows.map((row: Tokens.TableCell[], rowIndex: number) => <tr key={rowIndex}>{row.map((cell: Tokens.TableCell, cellIndex: number) => <td key={cellIndex}>{renderInline(tokenChildren(cell))}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    case "hr":
      return <hr />;
    case "space":
      return null;
    case "html":
      return <p>{token.text}</p>;
    default:
      return <p>{renderInline(tokenChildren(token)) || token.raw}</p>;
  }
}

function renderInline(tokens: Token[]): React.ReactNode[] {
  return tokens.map((token, index) => <React.Fragment key={`${token.type}-${index}`}>{renderInlineToken(token)}</React.Fragment>);
}

function renderInlineToken(token: Token): React.ReactNode {
  switch (token.type) {
    case "strong":
      return <strong>{renderInline(tokenChildren(token as Tokens.Strong))}</strong>;
    case "em":
      return <em>{renderInline(tokenChildren(token as Tokens.Em))}</em>;
    case "del":
      return <del>{renderInline(tokenChildren(token as Tokens.Del))}</del>;
    case "codespan":
      return <code>{token.text}</code>;
    case "br":
      return <br />;
    case "link":
      return isSafeLink((token as Tokens.Link).href) ? <a href={(token as Tokens.Link).href} target="_blank" rel="noreferrer">{renderInline(tokenChildren(token as Tokens.Link))}</a> : renderInline(tokenChildren(token as Tokens.Link));
    case "image":
      return token.text;
    case "text":
    case "escape":
      return tokenChildren(token).length > 0 ? renderInline(tokenChildren(token)) : (token as Tokens.Text | Tokens.Escape).text;
    default:
      return "text" in token ? token.text : token.raw;
  }
}

function tokenChildren(token: unknown): Token[] {
  if (!token || typeof token !== "object") return [];
  const children = (token as { tokens?: unknown }).tokens;
  return Array.isArray(children) ? children as Token[] : [];
}

function isSafeLink(value: string): boolean {
  try {
    const protocol = new URL(value, "https://sp-agent.local").protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}
