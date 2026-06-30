import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class AssetMetaType {
  @Field(() => ID)
  id: string;

  @Field()
  code: string;

  @Field({ nullable: true })
  issuer?: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  logoUrl?: string;
}
