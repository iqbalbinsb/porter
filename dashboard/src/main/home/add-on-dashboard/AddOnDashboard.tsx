import React, {
  useEffect,
  useState,
  useContext,
  useMemo,
  useCallback
} from "react";
import styled from "styled-components";
import _ from "lodash";

import addOn from "assets/add-ons.svg";
import time from "assets/time.png";
import healthy from "assets/status-healthy.png";
import grid from "assets/grid.png";
import list from "assets/list.png";
import notFound from "assets/not-found.png";

import { Context } from "shared/Context";
import { search } from "shared/search";
import api from "shared/api";
import { hardcodedIcons } from "shared/hardcodedNameDict";

import DashboardHeader from "../cluster-dashboard/DashboardHeader";

import Container from "components/porter/Container";
import Button from "components/porter/Button";
import Spacer from "components/porter/Spacer";
import Text from "components/porter/Text";
import SearchBar from "components/porter/SearchBar";
import Toggle from "components/porter/Toggle";
import { readableDate } from "shared/string_utils";
import Loading from "components/Loading";
import { Link } from "react-router-dom";
import Fieldset from "components/porter/Fieldset";
import Select from "components/porter/Select";
import ClusterProvisioningPlaceholder from "components/ClusterProvisioningPlaceholder";
import DashboardPlaceholder from "components/porter/DashboardPlaceholder";
import { useAuthState } from "main/auth/context";

type Props = {
};

const namespaceBlacklist = [
  "ack-system",
  "cert-manager",
  "ingress-nginx",
  "kube-node-lease",
  "kube-public",
  "kube-system",
  "monitoring",
  "porter-agent-system",
];

const templateBlacklist = [
  "web",
  "worker",
  "job",
  "umbrella",
];

const AddOnDashboard: React.FC<Props> = ({
}) => {

  const { currentProject, currentCluster } = useContext(Context);
  const [addOns, setAddOns] = useState([]);
  const [searchValue, setSearchValue] = useState("");
  const [view, setView] = useState("grid");
  const [isLoading, setIsLoading] = useState(true);

  const filteredAddOns = useMemo(() => {
    const filtered = addOns.filter((app) => {
      return (
        !namespaceBlacklist.includes(app.namespace) &&
        !templateBlacklist.includes(app.chart.metadata.name)
      );
    });

    const filteredBySearch = search(
      filtered ?? [],
      searchValue,
      {
        keys: ["name", "chart.metadata.name"],
        isCaseSensitive: false,
      }
    );

    return _.sortBy(filteredBySearch);
  }, [addOns, searchValue]);

  const getAddOns = async () => {
    try {
      setIsLoading(true);
      const res = await api.getCharts(
        "<token>",
        {
          limit: 50,
          skip: 0,
          byDate: false,
          statusFilter: [
            "deployed",
            "uninstalled",
            "pending",
            "pending-install",
            "pending-upgrade",
            "pending-rollback",
            "failed",
          ],
        },
        {
          id: currentProject.id,
          cluster_id: currentCluster.id,
          namespace: "all",
        }
      );
      setIsLoading(false);
      const charts = res.data || [];
      setAddOns(charts);
    } catch (err) {
      setIsLoading(false);
    };
  };

  useEffect(() => {
    // currentCluster sometimes returns as -1 and passes null check
    if (currentProject?.id >= 0 && currentCluster?.id >= 0) {
      getAddOns();
    }
  }, [currentCluster, currentProject]);

  const getExpandedChartLinkURL = useCallback((x: any) => {
    const params = new Proxy(new URLSearchParams(window.location.search), {
      get: (searchParams, prop: string) => searchParams.get(prop),
    });
    const cluster = currentCluster?.name;
    const route = `/applications/${cluster}/${x.namespace}/${x.name}`;
    const newParams = {
      // @ts-expect-error
      project_id: params.project_id,
      closeChartRedirectUrl: '/addons',
    };
    const newURLSearchParams = new URLSearchParams(
      _.omitBy(newParams, _.isNil)
    );
    return `${route}?${newURLSearchParams.toString()}`;
  }, [currentCluster]);

  return (
    <StyledAppDashboard>
      <DashboardHeader
        image={addOn}
        title="Add-ons"
        capitalize={false}
        description="Add-ons and supporting workloads for this project."
        disableLineBreak
      />
      {currentCluster?.status === "UPDATING_UNAVAILABLE" ? (
        <ClusterProvisioningPlaceholder />
      ) : (

        (addOns.length === 0 || (filteredAddOns.length === 0 && searchValue === "")) ? (

          isLoading ?
            (<Loading offset="-150px" />) : (
              <DashboardPlaceholder>
                <Text size={16}>
                  No add-ons have been deployed yet
                </Text>
                <Spacer y={0.5} />
                <Text color={"helper"}>
                  Deploy from our suite of curated add-ons.
                </Text>
                <Spacer y={1} />
                <Link to="/addons/new">
                  <Button alt onClick={() => { }} height="35px" >
                    Deploy add-ons <Spacer inline x={1} /> <i className="material-icons" style={{ fontSize: '18px' }}>east</i>
                  </Button>
                </Link>
              </DashboardPlaceholder>
            )
        ) : (
          <>
            <Container row spaced>
              <SearchBar
                value={searchValue}
                setValue={setSearchValue}
                placeholder="Search add-ons . . ."
                width="100%"
              />
              <Spacer inline x={2} />
              <Toggle
                items={[
                  { label: <ToggleIcon src={grid} />, value: "grid" },
                  { label: <ToggleIcon src={list} />, value: "list" },
                ]}
                active={view}
                setActive={setView}
              />
              <Spacer inline x={2} />
              <Link to="/addons/new">
                <Button onClick={() => { }} height="30px" width="130px">
                  <I className="material-icons">add</I> New add-on
                </Button>
              </Link>
            </Container>
            <Spacer y={1} />

            {filteredAddOns.length === 0 ? (
              <Fieldset>
                <Container row>
                  <PlaceholderIcon src={notFound} />
                  <Text color="helper">{searchValue === "" ? "No add-ons have been deployed yet." : "No matching add-ons were found."}</Text>
                </Container>
              </Fieldset>
            ) : (isLoading ? <Loading offset="-150px" /> : view === "grid" ? (
              <GridList>
                {(filteredAddOns ?? []).map((app: any, i: number) => {
                  return (
                    <Block to={getExpandedChartLinkURL(app)} key={i}>
                      <Container row>
                        <Icon
                          src={
                            hardcodedIcons[app.chart.metadata.name] ||
                            app.chart.metadata.icon
                          }
                        />
                        <Text size={14}>{app.name}</Text>
                        <Spacer inline x={2} />
                      </Container>
                      <StatusIcon src={healthy} />
                      <Container row>
                        <SmallIcon opacity="0.4" src={time} />
                        <Text size={13} color="#ffffff44">
                          {readableDate(app.info.last_deployed)}
                        </Text>
                      </Container>
                    </Block>
                  );
                })}
              </GridList>
            ) : (
              <List>
                {(filteredAddOns ?? []).map((app: any, i: number) => {
                  return (
                    <Row to={getExpandedChartLinkURL(app)} key={i}>
                      <Container row>
                        <MidIcon
                          src={
                            hardcodedIcons[app.chart.metadata.name] ||
                            app.chart.metadata.icon
                          }
                        />
                        <Text size={14}>{app.name}</Text>
                        <Spacer inline x={1} />
                        <MidIcon src={healthy} height="16px" />
                      </Container>
                      <Spacer height="15px" />
                      <Container row>
                        <SmallIcon opacity="0.4" src={time} />
                        <Text size={13} color="#ffffff44">
                          {readableDate(app.info.last_deployed)}
                        </Text>
                      </Container>
                    </Row>
                  );
                })}
              </List>
            )
            )}
          </>
        ))}
      <Spacer y={5} />
    </StyledAppDashboard >
  );
};

export default AddOnDashboard;

const PlaceholderIcon = styled.img`
  height: 13px;
  margin-right: 12px;
  opacity: 0.65;
`;

const Row = styled(Link) <{ isAtBottom?: boolean }>`
  cursor: pointer;
  display: block;
  padding: 15px;
  border-bottom: ${props => props.isAtBottom ? "none" : "1px solid #494b4f"};
  background: ${props => props.theme.clickable.bg};
  position: relative;
  border: 1px solid #494b4f;
  border-radius: 5px;
  margin-bottom: 15px;
  animation: fadeIn 0.3s 0s;
`;

const List = styled.div`
  overflow: hidden;
`;

const ToggleIcon = styled.img`
  height: 12px;
  margin: 0 5px;
  min-width: 12px;
`;

const StatusIcon = styled.img`
  position: absolute;
  top: 20px;
  right: 20px;
  height: 18px;
`;

const Icon = styled.img`
  height: 20px;
  margin-right: 13px;
`;

const MidIcon = styled.img<{ height?: string }>`
  height: ${props => props.height || "18px"};
  margin-right: 11px;
`;

const SmallIcon = styled.img<{ opacity?: string }>`
  margin-left: 2px;
  height: 14px;
  opacity: ${props => props.opacity || 1};
  margin-right: 10px;
`;

const Block = styled(Link)`
  height: 110px;
  flex-direction: column;
  display: flex;
  justify-content: space-between;
  cursor: pointer;
  padding: 20px;
  color: ${props => props.theme.text.primary};
  position: relative;
  border-radius: 5px;
  background: ${props => props.theme.clickable.bg};
  border: 1px solid #494b4f;
  :hover {
    border: 1px solid #7a7b80;
  }

  animation: fadeIn 0.3s 0s;
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

const GridList = styled.div`
  display: grid;
  grid-column-gap: 25px;
  grid-row-gap: 25px;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
`;

const I = styled.i`
  color: white;
  font-size: 14px;
  display: flex;
  align-items: center;
  margin-right: 5px;
  justify-content: center;
`;

const StyledAppDashboard = styled.div`
  width: 100%;
  height: 100%;
`;

const CentralContainer = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: left;
  align-items: left;   
`;