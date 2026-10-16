import MarkdownIt from 'markdown-it';

/**
 * The operator's texts (policy texts, the methodology) are Markdown, rendered here and only here (PLAN R99; shared by
 * the public site and the admin's preview since R196, so the preview is what the public will see): raw HTML
 * is escaped, never passed through; images are off (a text can't load anything); links go only to http(s) and mailto
 * addresses; headings start one level below the page's own h1. What this returns is safe to put in a page.
 */
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false }).disable([
  'image',
]);

markdown.validateLink = (url: string): boolean => /^(?:https?:|mailto:)/iu.test(url.trim());

markdown.core.ruler.push('shift_headings', (state) => {
  for (const token of state.tokens) {
    if (token.type === 'heading_open' || token.type === 'heading_close') {
      token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + 1)}`;
    }
  }
});

export const renderMarkdown = (text: string): string => markdown.render(text);
