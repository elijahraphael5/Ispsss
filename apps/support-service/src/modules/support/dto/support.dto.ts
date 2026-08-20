import { IsString, IsOptional, IsIn, IsInt, Min, Max, IsBoolean, IsNotEmpty, ValidateIf, IsArray } from 'class-validator';

export class CreateChatSessionDto {
  @IsOptional()
  @IsString()
  department?: string;
}

export class SendChatMessageDto {
  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentIds?: string[];
}

export class ReassignSessionDto {
  @IsString()
  @IsNotEmpty()
  agentId: string;
}

export class RateSessionDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;
}

export class PresenceDto {
  @IsIn(['ONLINE', 'AWAY', 'OFFLINE'])
  status: 'ONLINE' | 'AWAY' | 'OFFLINE';
}

export class ConvertSessionDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateTicketDto {
  @IsOptional()
  @IsString()
  subscriberId?: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsString()
  assignedAgentId?: string;
}

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'];
const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export class UpdateTicketDto {
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: string;

  @ValidateIf((o) => o.assignedAgentId !== null)
  @IsOptional()
  @IsString()
  assignedAgentId?: string | null;

  @IsOptional()
  @IsString()
  subject?: string;
}

export class AddTicketCommentDto {
  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsBoolean()
  internal?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentIds?: string[];
}

export class CreateCannedDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class UpdateCannedDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @ValidateIf((o) => o.category !== null)
  @IsOptional()
  @IsString()
  category?: string | null;
}