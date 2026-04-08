import React, { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";

export interface TooltipConfig {
  content: string;
  align?:
    | "left"
    | "right"
    | "center"
    | "center_right"
    | "center_left"
    | "icon_right"
    | "icon_left";
  bottom?: boolean;
}

interface TooltipProps extends TooltipConfig {
  children: React.ReactNode;
  title?: string;
  docsLink?: string;
  delay?: number;
  className?: string;
  forceHovered?: boolean;
  showIndicator?: boolean;
}

const Tooltip: React.FC<TooltipProps> = ({
  children,
  content,
  title,
  docsLink,
  align = "center",
  bottom = false,
  delay = 700,
  className,
  forceHovered = false,
  showIndicator = false,
}) => {
  const [isVisible, setIsVisible] = useState(forceHovered);
  const [shouldRender, setShouldRender] = useState(forceHovered);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unmountTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const HIDE_ANIMATION_MS = 75;

  const shouldShowIndicator = showIndicator || align?.includes("icon");

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (forceHovered) {
      setShouldRender(true);
      setIsVisible(true);
      return;
    }
    if (shouldRender && !isVisible) {
      timeoutId = setTimeout(() => setIsVisible(true), delay);
    } else if (!shouldRender) {
      setIsVisible(false);
    }
    return () => clearTimeout(timeoutId);
  }, [shouldRender, delay, isVisible, forceHovered]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
      if (unmountTimeoutRef.current) {
        clearTimeout(unmountTimeoutRef.current);
      }
    };
  }, []);

  let positionClass = "";
  if (align === "left") {
    positionClass = "left-0";
  } else if (align === "center") {
    positionClass = "left-1/2 -translate-x-1/2";
  } else if (align === "center_left") {
    positionClass = "left-0 translate-x-[-25%]";
  } else if (align === "center_right") {
    positionClass = "right-0 translate-x-[25%]";
  } else if (align === "right") {
    positionClass = "right-[-8px]";
  } else if (align === "icon_right") {
    positionClass = "left-[calc(100%+18px)] top-1/2 -translate-y-1/2";
  } else if (align === "icon_left") {
    positionClass = "right-[calc(100%+18px)] top-1/2 -translate-y-1/2";
  }

  const isIconAlignment = align?.includes("icon");
  const bottomClass =
    bottom && !isIconAlignment ? "top-full mt-[6px]" : "bottom-full mb-[6px]";
  const bottomClassTriangle =
    bottom && !isIconAlignment ? "top-full rotate-180" : "bottom-full";

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (forceHovered) return;
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (unmountTimeoutRef.current) {
      clearTimeout(unmountTimeoutRef.current);
      unmountTimeoutRef.current = null;
    }
    setIsVisible(false);
    unmountTimeoutRef.current = setTimeout(() => {
      setShouldRender(false);
      unmountTimeoutRef.current = null;
    }, HIDE_ANIMATION_MS);
  };

  const handleMouseEnter = () => {
    if (forceHovered) return;
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (unmountTimeoutRef.current) {
      clearTimeout(unmountTimeoutRef.current);
      unmountTimeoutRef.current = null;
      setIsVisible(true);
      return;
    }
    setShouldRender(true);
  };

  const handleMouseLeave = () => {
    if (forceHovered) return;
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      if (unmountTimeoutRef.current) {
        clearTimeout(unmountTimeoutRef.current);
      }
      unmountTimeoutRef.current = setTimeout(() => {
        setShouldRender(false);
        unmountTimeoutRef.current = null;
      }, HIDE_ANIMATION_MS);
      closeTimeoutRef.current = null;
    }, 200);
  };

  const handleDocsClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(docsLink, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className={`relative flex flex-col ${className ? className : ""} z-20`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {children}

      {shouldShowIndicator && (
        <div
          className="absolute top-1/2 -translate-y-1/2 right-0 translate-x-[calc(100%+6px)] cursor-help"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <HelpCircle
            size={14}
            className="text-[#b7bec7] opacity-60 hover:opacity-80 transition-opacity"
          />
        </div>
      )}

      {(shouldRender || forceHovered) && (
        <>
          {!isIconAlignment && (
            <div
              className={`absolute ${bottomClassTriangle} w-0 h-0 border-t-[6px] border-transparent border-t-[#375d8b] border-l-[8px] border-r-[8px] transition-all duration-75 opacity-1
                ${
                  isVisible || forceHovered
                    ? "opacity-100 translate-y-[0px]"
                    : `opacity-0 ${
                        bottom ? "-translate-y-[6px]" : "translate-y-[6px]"
                      }`
                }`}
              style={{
                left: "calc(50% - 8px)",
              }}
            />
          )}

          <div
            className={`absolute ${bottomClass} ${positionClass} transition-all duration-75 text-xs
              ${
                isVisible || forceHovered
                  ? "opacity-100 pointer-events-auto translate-y-[0px]"
                  : `opacity-0 pointer-events-none ${
                      bottom ? "translate-y-[-6px]" : "translate-y-[6px]"
                    }`
              }`}
          >
            <div
              className="p-2 rounded-md bg-[#375d8b] text-[#f6f8fb] break-words border border-[#4d79af] shadow-lg shadow-black/30"
              style={{ maxWidth: "140px", width: "max-content" }}
            >
              {title && <div className="font-bold mb-1">{title}</div>}
              <div>{content}</div>
              {docsLink && (
                <a
                  href={docsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-1 underline"
                  onClick={handleDocsClick}
                >
                  View Demo
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Tooltip;
export { Tooltip };
