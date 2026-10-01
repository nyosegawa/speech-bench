import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'

/** What the bench's server said when it could not answer, in place of the content it would have given. */
export function Failure({ error }: { error: string }) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">The bench could not answer</CardTitle>
        <CardDescription className="whitespace-pre-wrap">{error}</CardDescription>
      </CardHeader>
    </Card>
  )
}
