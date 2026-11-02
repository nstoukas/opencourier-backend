import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsOptional } from 'class-validator'
import { RefuseIfNotSentAsBoolean } from 'src/decorators/refuseIfNotSentAsBoolean.decorator'

// Spec 0020 (AC-1): the accept's optional body. `automatic` is true when the rider's phone accepted on
// its own (auto accept); it only marks the accept's event message.
export class AcceptDeliveryCourierInput {
  // @RefuseIfNotSentAsBoolean: the ValidationPipe would otherwise turn the text "true" into true.
  @ApiProperty({ type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  @RefuseIfNotSentAsBoolean()
  automatic?: boolean
}
