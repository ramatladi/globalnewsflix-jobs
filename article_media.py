"""Extract only a publisher's current Article image, never related-story or logo URLs."""
import json
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit, parse_qsl, urlencode


def canonical(url):
    p = urlsplit(url)
    if p.scheme != "https":
        return ""
    query = [(k, v) for k, v in parse_qsl(p.query) if not k.lower().startswith("utm_") and k.lower() not in ("gclid", "fbclid")]
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(sorted(query)), "")).rstrip("/")


class ArticleMetadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.canonical, self.scripts = {}, "", []
        self.in_json, self.buffer = False, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("content"):
            self.meta[(a.get("property") or a.get("name") or "").lower()] = a["content"]
        if tag == "link" and (a.get("rel") or "").lower() == "canonical":
            self.canonical = a.get("href") or ""
        if tag == "script" and (a.get("type") or "").lower() == "application/ld+json":
            self.in_json, self.buffer = True, []

    def handle_data(self, data):
        if self.in_json:
            self.buffer.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.in_json:
            self.scripts.append("".join(self.buffer))
            self.in_json = False


def article_image_urls(raw, url):
    parser = ArticleMetadata()
    parser.feed(raw)
    page = canonical(url)
    if not page:
        return []
    accepted = {page}
    alias = canonical(urljoin(url, parser.canonical))
    if urlsplit(alias).hostname == urlsplit(page).hostname:
        accepted.add(alias)
    nodes = []

    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            nodes.append(value)
            walk(value.get("@graph"))

    for script in parser.scripts:
        try:
            walk(json.loads(script))
        except (ValueError, TypeError):
            pass
    article_types = {"NewsArticle", "Article", "ReportageNewsArticle", "AnalysisNewsArticle"}
    articles = [n for n in nodes if article_types.intersection(n.get("@type") if isinstance(n.get("@type"), list) else [n.get("@type")])]
    own = []
    for node in articles:
        main = node.get("mainEntityOfPage")
        main = main.get("@id") if isinstance(main, dict) else main if isinstance(main, str) else None
        ref = node.get("url") or main or node.get("@id")
        if canonical(urljoin(url, ref)) in accepted if isinstance(ref, str) else len(articles) == 1:
            own.append(node)
    if not own and parser.meta.get("og:type", "").lower() not in ("article", "news"):
        return []
    result = []

    def add(value):
        if isinstance(value, list):
            for item in value:
                add(item)
        elif isinstance(value, dict):
            ref = next((n for n in nodes if n.get("@id") == value.get("@id")), {}) if value.get("@id") else {}
            add(value.get("contentUrl") or value.get("url") or ref.get("contentUrl") or ref.get("url"))
        elif isinstance(value, str):
            absolute = urljoin(url, value)
            if absolute.startswith("https://") and absolute not in result:
                result.append(absolute)

    for node in own:
        add(node.get("image"))
    for key in ("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"):
        add(parser.meta.get(key))
    return result[:6]


def photo_request_headers(url):
    """Must match media.js imageRequestHeaders: CDN negotiation changes the bytes."""
    parsed = urlsplit(url)
    host = parsed.hostname or ''
    if ':' in host:
        host = '[' + host + ']'
    port = parsed.port
    origin = parsed.scheme + '://' + host + (':' + str(port) if port and not (parsed.scheme == 'https' and port == 443) and not (parsed.scheme == 'http' and port == 80) else '')
    return {
        'user-agent': 'Mozilla/5.0 (compatible; GlobalNewsflix/1.0; +https://globalnewsflix.com/about)',
        'accept': 'image/jpeg,image/png,image/webp',
        'referer': origin + '/',
        'accept-encoding': 'identity',
    }


def same_publisher_host(first, second):
    a, b = urlsplit(first), urlsplit(second)
    return a.scheme == b.scheme == "https" and not a.username and not b.username and (a.hostname or "").removeprefix("www.") == (b.hostname or "").removeprefix("www.")


def approved_photo_url(value, site):
    """Only immutable, byte-addressed photos returned by the site's live-article API."""
    import re
    if isinstance(value, str) and value.startswith(site.rstrip("/") + "/"):
        value = value[len(site.rstrip("/")):]
    if not isinstance(value, str) or not re.fullmatch(r"/media/photos/[a-f0-9]{64}\.(?:jpg|png|webp)", value):
        return None
    return site.rstrip("/") + value
