import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { NewsCard } from './NewsCard'
import { AdCard } from './AdCard'
import { GripVertical } from 'lucide-react'

interface SortableNewsCardProps {
    id: string
    news: any
    index: number
    selected: boolean
    onToggleSelection: (id: string) => void
    onUpdateContent: (id: string, content: string, version: string) => void
    onUpdateAudio: (id: string, url: string, duration: number) => void
    onDelete: (id: string) => void
}

export function SortableNewsCard({ id, news, ...props }: SortableNewsCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 1,
        opacity: isDragging ? 0.5 : 1,
        position: 'relative' as 'relative',
    }

    return (
        <div ref={setNodeRef} style={style} className="group relative flex items-start gap-2">
            <div
                {...attributes}
                {...listeners}
                className="mt-8 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
            >
                <GripVertical className="h-5 w-5" />
            </div>
            <div className="flex-1">
                {news.type === 'ad' ? (
                    <AdCard ad={news} index={props.index} onDelete={props.onDelete} />
                ) : (
                    <NewsCard news={news} {...props} />
                )}
            </div>
        </div>
    )
}
