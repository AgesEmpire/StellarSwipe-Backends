import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AbiManagementService } from './abi-management.service';
import { UploadAbiDto } from './dto/upload-abi.dto';

@Controller('contracts/abi-management')
@UseGuards(JwtAuthGuard)
export class AbiManagementController {
  constructor(private readonly abiManagementService: AbiManagementService) {}

  @Post()
  uploadAbi(@Body() dto: UploadAbiDto, @Req() req: any) {
    return this.abiManagementService.uploadAbi(dto, {
      id: req.user?.userId ?? req.user?.id,
      roles: req.user?.roles ?? [],
    });
  }

  @Get(':contractName/:network')
  getLatestAbi(
    @Param('contractName') contractName: string,
    @Param('network') network: string,
  ) {
    return this.abiManagementService.getLatestAbi(contractName, network);
  }

  @Get(':contractName/:network/versions')
  listAbiVersions(
    @Param('contractName') contractName: string,
    @Param('network') network: string,
  ) {
    return this.abiManagementService.listAbiVersions(contractName, network);
  }

  @Get(':contractName/:network/versions/:version')
  getAbiVersion(
    @Param('contractName') contractName: string,
    @Param('network') network: string,
    @Param('version') version: string,
  ) {
    return this.abiManagementService.getAbiVersion(contractName, network, version);
  }
}
