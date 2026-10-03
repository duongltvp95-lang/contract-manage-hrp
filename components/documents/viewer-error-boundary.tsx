"use client";

import { Component, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Keeps a failing document from taking down the whole page.
 *
 * PDF.js can throw while rendering (a blocked fetch, a corrupt file, an object
 * removed from the bucket). Without a boundary the error escapes to Next's
 * global error page and the user loses the entire contract view — including the
 * metadata and the document selector. Here it degrades to an inline message.
 */
export class ViewerErrorBoundary extends Component<
  { children: ReactNode; onRetry?: () => void },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không hiển thị được tài liệu này",
    };
  }

  render() {
    if (this.state.message) {
      return (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertTitle>Không hiển thị được tài liệu</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{this.state.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  this.setState({ message: null });
                  this.props.onRetry?.();
                }}
              >
                Thử lại
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}
