"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Consecutive venue photos on one markdown line become an obvious horizontal
 * carousel: peek of the next frame, arrows, dots, and "1 of N". Streamdown
 * wraps each image; we only swap the paragraph when it is images and nothing
 * else, so ordinary prose is untouched.
 */

function isWhitespace(node: ReactNode): boolean {
  return typeof node === "string" && node.trim().length === 0;
}

function isImgElement(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  if (node.type === "img") return true;
  const props = node.props as { src?: unknown; node?: { tagName?: string } };
  if (typeof props.src === "string") return true;
  return props.node?.tagName === "img";
}

function countImgs(node: ReactNode): number {
  if (!isValidElement(node)) return 0;
  if (isImgElement(node)) return 1;
  const kids = (node.props as { children?: ReactNode }).children;
  return Children.toArray(kids).reduce<number>((n, child) => n + countImgs(child), 0);
}

function hasSubstantialText(node: ReactNode): boolean {
  if (typeof node === "number") return true;
  if (typeof node === "string") return node.trim().length > 0;
  if (!isValidElement(node)) return false;
  if (isImgElement(node)) return false;
  const kids = (node.props as { children?: ReactNode }).children;
  return Children.toArray(kids).some(hasSubstantialText);
}

export function VenueParagraph({
  children,
  node: _node,
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { node?: unknown }) {
  const items = Children.toArray(children).filter((child) => !isWhitespace(child));
  let images = 0;
  for (const child of items) images += countImgs(child);
  const text = items.some(hasSubstantialText);
  if (images >= 2 && !text) {
    return <VenueCarousel>{items}</VenueCarousel>;
  }
  return (
    <p className={className} {...props}>
      {children}
    </p>
  );
}

export function VenueCarousel({ children }: { readonly children: ReactNode }) {
  const slides = Children.toArray(children);
  const n = slides.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const go = useCallback(
    (next: number) => {
      const track = trackRef.current;
      if (!track || n === 0) return;
      const i = ((next % n) + n) % n;
      const slide = track.children[i] as HTMLElement | undefined;
      if (!slide) return;
      const left = slide.offsetLeft - (track.clientWidth - slide.clientWidth) / 2;
      track.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
      setIndex(i);
    },
    [n],
  );

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const kids = Array.from(track.children) as HTMLElement[];
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < kids.length; i += 1) {
        const center = kids[i].offsetLeft + kids[i].offsetWidth / 2;
        const dist = Math.abs(center - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      setIndex(best);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, [n]);

  if (n === 0) return null;

  return (
    <div
      aria-label="Venue photos"
      aria-roledescription="carousel"
      className="venus-carousel"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(index + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(index - 1);
        }
      }}
      role="region"
      tabIndex={0}
    >
      <div className="venus-carousel-chrome">
        <span>Venue photos · swipe or tap arrows</span>
        <span aria-live="polite" className="tabular-nums">
          {index + 1} of {n}
        </span>
      </div>
      <div className="venus-carousel-frame">
        <button
          aria-label="Previous photo"
          className="venus-carousel-nav"
          data-dir="prev"
          onClick={() => go(index - 1)}
          type="button"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <div className="venus-carousel-track" ref={trackRef}>
          {slides.map((slide, i) => (
            <div
              aria-hidden={i !== index}
              className="venus-carousel-slide"
              key={i}
              onErrorCapture={(e) => {
                const t = e.target as HTMLElement | null;
                if (t?.tagName === "IMG") {
                  const slideEl = t.closest(".venus-carousel-slide");
                  if (slideEl instanceof HTMLElement) slideEl.style.display = "none";
                }
              }}
            >
              {slide}
            </div>
          ))}
        </div>
        <button
          aria-label="Next photo"
          className="venus-carousel-nav"
          data-dir="next"
          onClick={() => go(index + 1)}
          type="button"
        >
          <ChevronRightIcon className="size-5" />
        </button>
      </div>
      <div className="venus-carousel-dots">
        {slides.map((_, i) => (
          <button
            aria-current={i === index ? "true" : undefined}
            aria-label={`Photo ${i + 1} of ${n}`}
            className={cn("venus-carousel-dot", i === index && "is-active")}
            key={i}
            onClick={() => go(i)}
            type="button"
          />
        ))}
      </div>
    </div>
  );
}
