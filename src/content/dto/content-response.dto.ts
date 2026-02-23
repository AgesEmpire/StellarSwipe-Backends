import { ContentType, ContentStatus } from '../entities/provider-content.entity';

export class ContentResponseDto {
  id: string;
  providerId: string;
  type: ContentType;
  title: string;
  body: string;
  tags: string[];
  published: boolean;
  status: ContentStatus;
  views: number;
  likes: number;
  shares: number;
  thumbnailUrl?: string;
  videoUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ContentListResponseDto {
  content: ContentResponseDto[];
  total: number;
  page: number;
  limit: number;
}
